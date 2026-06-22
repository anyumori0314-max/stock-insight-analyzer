import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";

import { stockReportSchema } from "../schemas/report";
import type { StockReport } from "../types/report";
import type { StockDataMode, StockRange } from "../types/stock";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

/**
 * Persistent stock-report cache (Phase 11-3).
 *
 * WHY FILE-BASED, NOT SQLite: the task names SQLite as the first candidate but
 * allows a file cache "with a stated reason" when SQLite is overkill. For this
 * MVP it is: the only thing persisted is a handful of small, already-validated
 * JSON `StockReport`s keyed by `ticker:range:dataMode` with a TTL. A file-per-entry
 * store gives us durability, atomic writes, per-entry TTL, schema versioning, LRU
 * eviction and trivial corruption recovery (delete the bad file) WITHOUT adding
 * a native dependency (`better-sqlite3`) — which on Windows needs a toolchain,
 * enlarges the `npm audit` surface, and is disproportionate for ~100 tiny rows.
 * The Repository interface below is storage-agnostic, so swapping in SQLite
 * later is a localized change.
 *
 * DATA-MODE SEPARATION: every entry records the `dataMode` ("live"/"mock") that
 * produced it, both in the file NAME (live and mock never collide on disk) and in
 * the envelope METADATA. A read for one mode never returns the other mode's data,
 * and an entry whose stored `report.source` disagrees with its `dataMode` is
 * treated as poisoned and deleted — so mock data can never be re-published as
 * `source:"live"` (or vice-versa).
 *
 * LRU BY LAST ACCESS: each read bumps the entry's `lastAccessMs` (best-effort,
 * atomic rewrite). Eviction removes expired entries first, then the genuinely
 * least-recently-USED ones (not merely the oldest-written), so a frequently read
 * entry is not evicted just because it was written long ago. The access update is
 * persisted in the envelope (not relied upon via filesystem mtime), so LRU is
 * deterministic and identical across Windows / macOS / Linux.
 *
 * SAFETY: only the public, schema-validated `StockReport` is written — never the
 * API key or raw provider responses. Reads re-validate (schema + version + TTL +
 * key + dataMode + source integrity); ANY anomaly (missing/corrupt/expired/
 * mismatched/version-bump) yields a clean miss and best-effort deletion, so a
 * poisoned file can never be served. Writes are atomic (temp file + rename) and
 * every fs error is swallowed so a read-only/full disk degrades to memory-only
 * operation, never a 500.
 */

/**
 * Bumped whenever the on-disk envelope shape changes; old entries are dropped on
 * read. v2 added `dataMode` + `lastAccessMs` and moved `dataMode` into the file
 * name, so any v1 file is silently ignored and deleted.
 */
export const STOCK_REPORT_CACHE_SCHEMA_VERSION = 2;

export interface CachedReport {
  report: StockReport;
  /** Absolute expiry (epoch ms). */
  expiresAtMs: number;
}

export interface StockReportRepository {
  /** Returns a fresh, valid cached report for the (key, mode), or null on any miss. */
  get(ticker: string, range: StockRange, dataMode: StockDataMode): Promise<CachedReport | null>;
  /** Persists a validated report under the (key, mode) with the given expiry (best effort). */
  set(
    ticker: string,
    range: StockRange,
    dataMode: StockDataMode,
    report: StockReport,
    expiresAtMs: number
  ): Promise<void>;
  /** Removes the entry for the (key, mode), if any (best effort). */
  delete(ticker: string, range: StockRange, dataMode: StockDataMode): Promise<void>;
}

interface CacheEnvelope {
  schemaVersion: number;
  key: string;
  dataMode: StockDataMode;
  expiresAtMs: number;
  /** Epoch ms of the most recent read/write — drives true LRU eviction. */
  lastAccessMs: number;
  report: unknown;
}

export interface FileReportRepositoryOptions {
  /** Directory the cache files live in (created on demand). */
  dir: string;
  /** Hard cap on stored files; expired-then-LRU evicted past this. */
  maxEntries?: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Structured logger for best-effort warnings (defaults to silent). */
  logger?: Logger;
}

function cacheKey(ticker: string, range: StockRange): string {
  return `${ticker}:${range}`;
}

/** Maps a (ticker, range, mode) to a filesystem-safe file name (inputs pre-validated). */
function fileNameFor(ticker: string, range: StockRange, dataMode: StockDataMode): string {
  const safe = `${ticker}__${range}__${dataMode}`.replace(/[^A-Za-z0-9.-]/g, "_");
  return `${safe}.json`;
}

export function createFileReportRepository(
  options: FileReportRepositoryOptions
): StockReportRepository {
  const dir = options.dir;
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 100));
  const now = options.now ?? Date.now;
  const logger = options.logger ?? silentLogger;

  async function safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Already gone / unreadable — nothing to recover.
    }
  }

  /** Atomically writes an envelope (temp file + rename). Returns false on failure. */
  async function atomicWrite(filePath: string, envelope: CacheEnvelope): Promise<boolean> {
    const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(tmpPath, JSON.stringify(envelope), "utf8");
      await rename(tmpPath, filePath);
      return true;
    } catch {
      await safeUnlink(tmpPath);
      return false;
    }
  }

  async function evictIfNeeded(keepFile: string): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }
    // Overwriting an existing key does not grow the set.
    const projected = files.includes(keepFile) ? files.length : files.length + 1;
    if (projected <= maxEntries) {
      return;
    }
    const toRemove = projected - maxEntries;
    const candidates = files.filter((f) => f !== keepFile);

    // Read each candidate's expiry + last-access. Unreadable / corrupt files are
    // ranked for removal first (treated as expired with the oldest access time).
    const nowMs = now();
    const meta = await Promise.all(
      candidates.map(async (f) => {
        try {
          const raw = await readFile(path.join(dir, f), "utf8");
          const env = JSON.parse(raw) as Partial<CacheEnvelope>;
          const expiresAtMs = typeof env.expiresAtMs === "number" ? env.expiresAtMs : 0;
          const lastAccessMs = typeof env.lastAccessMs === "number" ? env.lastAccessMs : 0;
          return { f, expiresAtMs, lastAccessMs, expired: expiresAtMs <= nowMs };
        } catch {
          return { f, expiresAtMs: 0, lastAccessMs: 0, expired: true };
        }
      })
    );

    // Expired (and corrupt) entries are removed FIRST; among the rest, the
    // least-recently-accessed go next — i.e. true LRU, by use order not write order.
    meta.sort((a, b) => {
      if (a.expired !== b.expired) {
        return a.expired ? -1 : 1;
      }
      return a.lastAccessMs - b.lastAccessMs;
    });
    for (let i = 0; i < toRemove && i < meta.length; i += 1) {
      await safeUnlink(path.join(dir, meta[i].f));
    }
  }

  return {
    async get(ticker, range, dataMode) {
      const key = cacheKey(ticker, range);
      const filePath = path.join(dir, fileNameFor(ticker, range, dataMode));

      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        return null; // missing / unreadable -> clean miss
      }

      let envelope: CacheEnvelope;
      try {
        envelope = JSON.parse(raw) as CacheEnvelope;
      } catch {
        await safeUnlink(filePath); // corrupt JSON -> drop and miss
        return null;
      }

      if (
        !envelope ||
        envelope.schemaVersion !== STOCK_REPORT_CACHE_SCHEMA_VERSION ||
        envelope.key !== key ||
        envelope.dataMode !== dataMode ||
        typeof envelope.expiresAtMs !== "number"
      ) {
        // Stale schema (incl. any v1 entry) / wrong key / wrong mode -> drop.
        await safeUnlink(filePath);
        return null;
      }

      if (envelope.expiresAtMs <= now()) {
        await safeUnlink(filePath); // expired -> drop
        return null;
      }

      const parsed = stockReportSchema.safeParse(envelope.report);
      if (
        !parsed.success ||
        parsed.data.ticker !== ticker ||
        parsed.data.range !== range ||
        // The stored report's source MUST agree with the entry's dataMode, or it
        // is poisoned (e.g. mock data masquerading as live) -> drop and miss.
        parsed.data.source !== dataMode
      ) {
        await safeUnlink(filePath);
        return null;
      }

      // Bump last-access so a frequently read entry survives eviction (true LRU
      // by USE, not write order). Persisted in the envelope — not via filesystem
      // mtime — so the order is deterministic and identical on every OS. The
      // rewrite is atomic and best-effort: a failure (e.g. read-only disk) is
      // logged but the cached value is still served.
      const refreshed: CacheEnvelope = { ...envelope, lastAccessMs: now() };
      const touched = await atomicWrite(filePath, refreshed);
      if (!touched) {
        logger.warn("cache.access.touch.failed", { ticker, range });
      }

      return { report: parsed.data, expiresAtMs: envelope.expiresAtMs };
    },

    async set(ticker, range, dataMode, report, expiresAtMs) {
      const fileName = fileNameFor(ticker, range, dataMode);
      const filePath = path.join(dir, fileName);
      const envelope: CacheEnvelope = {
        schemaVersion: STOCK_REPORT_CACHE_SCHEMA_VERSION,
        key: cacheKey(ticker, range),
        dataMode,
        expiresAtMs,
        lastAccessMs: now(),
        report,
      };

      await evictIfNeeded(fileName);
      const ok = await atomicWrite(filePath, envelope);
      if (!ok) {
        // Write failed (read-only / full disk): degrade to memory-only.
        logger.warn("cache.persist.failed", { ticker, range });
      }
    },

    async delete(ticker, range, dataMode) {
      await safeUnlink(path.join(dir, fileNameFor(ticker, range, dataMode)));
    },
  };
}
