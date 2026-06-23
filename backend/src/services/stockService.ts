import { buildStockReport } from "../analytics/report";
import type { DataSourceKind, DataSourceMetadata } from "../domain/historical";
import { stockReportSchema } from "../schemas/report";
import type { ImportRunRepository } from "../repositories/importRunRepository";
import type { PriceRepository } from "../repositories/priceRepository";
import type { SyncStateRepository } from "../repositories/syncStateRepository";
import { errorFor, type ErrorCode } from "../types/errors";
import type { StockReport } from "../types/report";
import {
  DEFAULT_RANGE,
  RANGE_LABEL,
  RANGE_TRADING_DAYS,
  type StockDataMode,
  type StockRange,
  type StockTimeSeries,
} from "../types/stock";
import { createAlphaVantageClient, type AlphaVantageClient } from "./alphaVantageClient";
import type { DataFreshnessService } from "./dataFreshnessService";
import type { HistoricalDataService } from "./historicalDataService";
import type { MarketDataSyncService, SyncOutcome } from "./marketDataSyncService";
import { createMockStockDataProvider } from "./mockStockDataProvider";
import type { StockReportRepository } from "./reportRepository";
import { createTtlCache, type TtlCache } from "./ttlCache";

/** Daily bars only change after the close, so a multi-hour TTL is safe. */
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

export type { StockDataMode };

export interface StockService {
  /**
   * Returns the analyzed report for an (already validated) ticker and window.
   * The compact provider series is sliced to the window's trailing N trading
   * days, so `1m` and `3m` return genuinely different periods from one fetch.
   */
  getReport(ticker: string, range?: StockRange): Promise<StockReport>;
}

export interface StockServiceOptions {
  /** Alpha Vantage key. When absent (and no `client` is injected), requests
   * fail with `API_KEY_MISSING` instead of crashing app startup. */
  apiKey?: string;
  /**
   * Data source. "live" (default) builds the Alpha Vantage client from `apiKey`;
   * "mock" injects the deterministic in-process provider (no key / no network).
   * The chosen mode is stamped onto every report as `source` so the UI can flag
   * mock data — the switch lives entirely here in the provider layer.
   */
  dataMode?: StockDataMode;
  /** Pre-built client (tests inject a fake; avoids network + real key). */
  client?: AlphaVantageClient;
  /** Pre-built in-memory cache (tests inject one with a controllable clock). */
  cache?: TtlCache<StockReport>;
  /** Optional persistent (disk) cache forming the second cache layer. */
  reportRepository?: StockReportRepository;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  /** Outbound per-request timeout, forwarded when building the default client. */
  timeoutMs?: number;
  /** Hard cap on accepted provider points, forwarded when building the client. */
  maxPoints?: number;
  // --- Historical / hybrid mode dependencies (Phase 13–15) ------------------
  // Required only when `dataMode` is "historical" or "hybrid"; ignored otherwise.
  /** Reads the SQLite history store into a provider-agnostic series. */
  historicalService?: HistoricalDataService;
  /** Decides + performs the (at most one) provider top-up for hybrid mode. */
  syncService?: MarketDataSyncService;
  /** Computes the freshness/stale verdict for the data-status metadata. */
  freshnessService?: DataFreshnessService;
  /** Used for `latestTradeDate` / `recordCount` in the data-status metadata. */
  priceRepository?: PriceRepository;
  /** Used for `apiSyncedAt` in the data-status metadata. */
  syncStateRepository?: SyncStateRepository;
  /** Used for `csvImportedAt` in the data-status metadata. */
  importRunRepository?: ImportRunRepository;
  /** Injectable clock (tests). */
  now?: () => Date;
}

function cacheKey(ticker: string, range: StockRange): string {
  return `${ticker}:${range}`;
}

/**
 * Slices a full compact series to the requested window's trailing N trading days.
 *
 * The compact feed is ~100 bars, so the supported windows (`1m` ~21d, `3m` ~63d)
 * are fully covered and yield genuinely different periods. Should a provider ever
 * return fewer bars than the window needs, we serve what is available with an
 * explicit, non-fatal warning — never a fabricated extension. Metrics are then
 * computed over exactly this window, so the indicators always match the displayed
 * period. Exported for unit testing.
 */
export function sliceSeriesToRange(series: StockTimeSeries, range: StockRange): StockTimeSeries {
  const want = RANGE_TRADING_DAYS[range];
  const available = series.bars.length;
  const bars = available > want ? series.bars.slice(available - want) : series.bars;
  const warnings = [...series.warnings];
  if (available < want) {
    warnings.push(
      `選択した期間（${RANGE_LABEL[range]}＝約${want}営業日）に対し、利用可能な履歴は${available}営業日です。取得できた範囲で表示しています。`
    );
  }
  return { ...series, range, bars, warnings };
}

/**
 * Validates the final, public-facing report immediately before it is returned.
 *
 * This is the last line of defense: it guarantees the response matches the
 * documented contract (no NaN/Infinity, no missing fields, valid cache metadata
 * / source / priceBasis / range). A failure is converted to a safe, generic
 * `PROVIDER_RESPONSE_INVALID` — internal schema details are never exposed (in
 * development OR production). Exported for direct unit testing.
 */
export function assertPublicReport(report: StockReport): StockReport {
  const parsed = stockReportSchema.safeParse(report);
  if (!parsed.success) {
    throw errorFor("PROVIDER_RESPONSE_INVALID", "public-schema");
  }
  // Return the VALIDATED, stripped value (strict schema => exactly the public
  // fields), never the caller's object, so an internal field cannot ride along.
  return parsed.data;
}

/**
 * Returns a fresh report object with cache + source metadata stamped in, then
 * validates it. A new top-level object is built every call (the cached value is
 * never mutated), so a cache hit cannot be corrupted by a later request.
 *
 * `source` is supplied explicitly: for a fresh fetch / memory hit it is the
 * active data mode, but for a PERSISTENT hit it is the report's OWN stored source,
 * which must never be overwritten with the current mode (that is what would let a
 * mock-saved report be re-published as live).
 */
function stampReport(
  report: StockReport,
  hit: boolean,
  expiresAtMs: number,
  source: StockDataMode
): StockReport {
  const stamped: StockReport = {
    ...report,
    source,
    cache: { hit, expiresAt: new Date(expiresAtMs).toISOString() },
  };
  return assertPublicReport(stamped);
}

/**
 * Like {@link stampReport} but for SQLite-backed (historical/hybrid) reports: it
 * also attaches the optional `dataStatus` metadata. When `dataStatus` is
 * undefined the field is omitted entirely, so the live/mock contract is
 * unaffected. The completed report is validated (strict schema) before return.
 */
function finalize(
  report: StockReport,
  source: StockDataMode,
  hit: boolean,
  expiresAtMs: number,
  dataStatus: DataSourceMetadata | undefined
): StockReport {
  const stamped: StockReport = {
    ...report,
    source,
    cache: { hit, expiresAt: new Date(expiresAtMs).toISOString() },
    ...(dataStatus ? { dataStatus } : {}),
  };
  return assertPublicReport(stamped);
}

/**
 * Orchestrates the stock data flow with a TWO-LAYER cache (memory + optional
 * persistent disk), keyed by `ticker:range`:
 *   - memory hit     -> serve immediately, `cache.hit = true`.
 *   - persistent hit -> re-validate with `assertPublicReport` BEFORE warming the
 *                       memory layer; serve `hit = true` PRESERVING the stored
 *                       `source`. An invalid or mode-mismatched entry is deleted
 *                       from disk and falls through to a fresh fetch.
 *   - in-flight      -> coalesce concurrent same-key requests onto one provider
 *                       call (dedup map).
 *   - miss           -> fetch compact series, slice to the window, analyze, stamp
 *                       metadata, VALIDATE, then write BOTH cache layers and
 *                       return the validated report.
 *
 * The persistent layer is keyed by `ticker:range:dataMode`, so a `mock` entry is
 * never served while running `live` (and vice-versa); the active mode is also
 * re-checked against the stored `source` before serving. Only reports that pass
 * public-schema validation are cached (validation happens BEFORE either
 * `cache.set`), so an invalid report is never stored OR promoted from disk into
 * memory. The persistent write is best-effort: a disk failure degrades to
 * memory-only and never fails the request. Errors and the in-flight promise are
 * always cleared in `finally`, so a failure never poisons the cache and the next
 * request retries.
 */
export function createStockService(options: StockServiceOptions = {}): StockService {
  const cache =
    options.cache ??
    createTtlCache<StockReport>({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      maxEntries: options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
    });

  const repository = options.reportRepository;
  const dataMode: StockDataMode = options.dataMode ?? "live";
  const now = options.now ?? (() => new Date());

  // The direct provider client is only used by the live/mock path. historical
  // serves purely from SQLite; hybrid reaches the provider via the sync service.
  let client: AlphaVantageClient | undefined = options.client;
  if (!client && (dataMode === "live" || dataMode === "mock")) {
    if (dataMode === "mock") {
      // Mock mode needs no API key and performs no network I/O.
      client = createMockStockDataProvider();
    } else if (options.apiKey) {
      client = createAlphaVantageClient({
        apiKey: options.apiKey,
        timeoutMs: options.timeoutMs,
        maxPoints: options.maxPoints,
      });
    }
  }

  // Holds the already-validated report (with cache.hit = false) so every coalesced
  // caller receives the exact object that was cached.
  const inflight = new Map<string, Promise<StockReport>>();

  /**
   * Builds the public data-status metadata for a SQLite-backed (historical /
   * hybrid) report. Only SAFE fields — no paths, stacks or key state.
   */
  function buildDataStatus(
    report: StockReport,
    latestStored: string | null,
    stale: boolean,
    recordCount: number,
    sync: SyncOutcome | null
  ): DataSourceMetadata {
    const synced = Boolean(sync && sync.result === "success" && sync.syncedDates.length > 0);
    const dataSource: DataSourceKind = synced ? "api" : "sqlite";
    const apiSyncedAt =
      sync?.apiSyncedAt ?? options.syncStateRepository?.get(report.ticker)?.lastSuccessAt ?? null;
    const csvImportedAt = options.importRunRepository?.latestCompleted("csv")?.finishedAt ?? null;
    return {
      dataMode,
      dataSource,
      latestTradeDate: latestStored,
      lastUpdatedAt: now().toISOString(),
      csvImportedAt,
      apiSyncedAt,
      persistent: true,
      stale,
      fallbackUsed: dataMode === "hybrid" && sync?.result === "failed",
      recordCount,
    };
  }

  /**
   * Serves a historical/hybrid report: SQLite first, with (for hybrid) at most one
   * provider top-up; on a provider failure the stored data is still served
   * (fallback). A memory-cache hit short-circuits both. Only a safe error is raised
   * when there is no stored data at all.
   */
  async function getHistoricalReport(ticker: string, range: StockRange): Promise<StockReport> {
    const historicalService = options.historicalService;
    const freshnessService = options.freshnessService;
    const priceRepository = options.priceRepository;
    if (!historicalService || !freshnessService || !priceRepository) {
      // Misconfiguration: a SQLite mode without its dependencies. Safe, generic.
      throw errorFor("INTERNAL_SERVER_ERROR", "historical-deps-missing");
    }

    const key = cacheKey(ticker, range);
    const cached = cache.getWithMeta(key);
    if (cached) {
      // Preserve the stored source + data-status; only refresh cache metadata.
      return finalize(cached.value, cached.value.source, true, cached.expiresAt, cached.value.dataStatus);
    }

    let sync: SyncOutcome | null = null;
    if (dataMode === "hybrid" && options.syncService) {
      // At most one provider call; failures are swallowed into the outcome so we
      // can still fall back to stored data below.
      sync = await options.syncService.sync(ticker, range);
    }

    const series = historicalService.getTimeSeries(ticker, range);
    if (!series) {
      // No stored data: only NOW is an error appropriate (hybrid fallback can't help).
      if (sync && sync.result === "failed" && sync.errorCode) {
        throw errorFor(sync.errorCode as ErrorCode, "hybrid-no-local-data");
      }
      throw errorFor("INSUFFICIENT_DATA", "no-local-data");
    }

    const windowed = sliceSeriesToRange(series, range);
    const report = buildStockReport(windowed);
    const latestStored = priceRepository.getLatestTradeDate(ticker);
    const freshness = freshnessService.compute(latestStored, priceRepository.countBars(ticker));
    const dataStatus = buildDataStatus(
      { ...report, ticker: series.ticker },
      latestStored,
      freshness.stale,
      report.series.length,
      sync
    );

    const expiresAt = cache.peekExpiry();
    const finalized = finalize(report, dataMode, false, expiresAt, dataStatus);
    cache.set(key, finalized, expiresAt);
    return finalized;
  }

  return {
    async getReport(ticker: string, range: StockRange = DEFAULT_RANGE): Promise<StockReport> {
      if (dataMode === "historical" || dataMode === "hybrid") {
        return getHistoricalReport(ticker, range);
      }

      if (!client) {
        throw errorFor("API_KEY_MISSING");
      }

      const key = cacheKey(ticker, range);

      // 1. Memory layer. Re-stamped + re-validated on every hit (strict schema).
      const cached = cache.getWithMeta(key);
      if (cached) {
        return stampReport(cached.value, true, cached.expiresAt, dataMode);
      }

      // 2. Persistent layer. A disk entry is VALIDATED before it is allowed into
      // the memory layer, and its stored `source` is preserved (never overwritten
      // with the active mode) and re-checked against `dataMode`. An invalid or
      // mismatched entry is deleted from disk and we fall through to a fresh fetch
      // — never promoting a poisoned report into memory or serving it.
      if (repository) {
        const persisted = await repository.get(ticker, range, dataMode);
        if (persisted) {
          try {
            const validated = stampReport(
              persisted.report,
              true,
              persisted.expiresAtMs,
              persisted.report.source
            );
            if (validated.source !== dataMode) {
              throw errorFor("PROVIDER_RESPONSE_INVALID", "persistent-mode-mismatch");
            }
            cache.set(key, validated, persisted.expiresAtMs);
            return validated;
          } catch {
            await repository.delete(ticker, range, dataMode);
          }
        }
      }

      const existing = inflight.get(key);
      if (existing) {
        // Coalesced onto the in-flight miss: share its already-validated report.
        return await existing;
      }

      const activeClient = client;
      const activeRepository = repository;
      const promise = (async () => {
        const fullSeries = await activeClient.fetchDailySeries(ticker, range);
        const windowed = sliceSeriesToRange(fullSeries, range);
        const report = buildStockReport(windowed);
        // Reserve the expiry this entry will receive, then stamp source + cache
        // metadata and VALIDATE the completed public report. An invalid report
        // throws here — BEFORE any `cache.set` — so it is never stored.
        const expiresAt = cache.peekExpiry();
        const validated = stampReport(report, false, expiresAt, dataMode);
        // Cache exactly the validated object in both layers (disk best-effort).
        cache.set(key, validated, expiresAt);
        if (activeRepository) {
          // Persistent write is best-effort: the memory layer already holds the
          // report, so a repository failure must never fail the request. The
          // active mode is stored so live and mock entries stay separated.
          try {
            await activeRepository.set(ticker, range, dataMode, validated, expiresAt);
          } catch {
            // Degrade to memory-only.
          }
        }
        return validated;
      })();
      inflight.set(key, promise);

      try {
        return await promise;
      } finally {
        inflight.delete(key);
      }
    },
  };
}
