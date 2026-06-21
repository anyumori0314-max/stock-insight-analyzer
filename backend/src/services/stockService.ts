import { buildStockReport } from "../analytics/report";
import { stockReportSchema } from "../schemas/report";
import { errorFor } from "../types/errors";
import type { StockReport } from "../types/report";
import {
  createAlphaVantageClient,
  DEFAULT_RANGE,
  type AlphaVantageClient,
} from "./alphaVantageClient";
import { createMockStockDataProvider } from "./mockStockDataProvider";
import { createTtlCache, type TtlCache } from "./ttlCache";

/** Daily bars only change after the close, so a multi-hour TTL is safe. */
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

export type StockDataMode = "live" | "mock";

export interface StockService {
  /**
   * Returns the analyzed report for a (already validated) ticker. The range is
   * fixed to the MVP's single window (`"100d"`); no range argument is accepted,
   * so an unsupported range can never reach the provider or the cache.
   */
  getReport(ticker: string): Promise<StockReport>;
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
  /** Pre-built cache (tests inject one with a controllable clock). */
  cache?: TtlCache<StockReport>;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  /** Outbound per-request timeout, forwarded when building the default client. */
  timeoutMs?: number;
  /** Hard cap on accepted provider points, forwarded when building the client. */
  maxPoints?: number;
}

function cacheKey(ticker: string, range: string): string {
  return `${ticker}:${range}`;
}

/**
 * Validates the final, public-facing report immediately before it is returned.
 *
 * This is the last line of defense: it guarantees the response matches the
 * documented contract (no NaN/Infinity, no missing fields, valid cache metadata
 * / source / priceBasis). A failure is converted to a safe, generic
 * `PROVIDER_RESPONSE_INVALID` — internal schema details are never exposed (in
 * development OR production). Exported for direct unit testing.
 */
export function assertPublicReport(report: StockReport): StockReport {
  const parsed = stockReportSchema.safeParse(report);
  if (!parsed.success) {
    // Internal schema details / field names / stacks are never surfaced.
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
 */
function withMeta(
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
 * Orchestrates the stock data flow:
 *   - cache hit  -> serve immediately (no provider call), `cache.hit = true`.
 *   - in-flight  -> coalesce concurrent requests for the same key onto one
 *                   provider call (dedup map), so 10 simultaneous requests for
 *                   AAPL hit Alpha Vantage exactly once.
 *   - miss       -> fetch + analyze, stamp metadata, VALIDATE, then cache the
 *                   validated report and return that same object.
 *
 * Only reports that pass the public-schema validation are cached: validation
 * happens BEFORE `cache.set`, so an invalid provider report is never stored (and
 * the next request re-fetches instead of serving a poisoned cache entry). Errors
 * (and the in-flight promise) are always cleared in `finally`, so a failure never
 * poisons the cache and the next request retries cleanly.
 */
export function createStockService(options: StockServiceOptions = {}): StockService {
  const cache =
    options.cache ??
    createTtlCache<StockReport>({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      maxEntries: options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
    });

  const dataMode: StockDataMode = options.dataMode ?? "live";

  let client: AlphaVantageClient | undefined = options.client;
  if (!client) {
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

  return {
    async getReport(ticker: string): Promise<StockReport> {
      if (!client) {
        throw errorFor("API_KEY_MISSING");
      }

      // Range is fixed to the single supported window.
      const range = DEFAULT_RANGE;
      const key = cacheKey(ticker, range);

      const cached = cache.getWithMeta(key);
      if (cached) {
        return withMeta(cached.value, true, cached.expiresAt, dataMode);
      }

      const existing = inflight.get(key);
      if (existing) {
        // Coalesced onto the in-flight miss: share its already-validated report.
        return await existing;
      }

      const activeClient = client;
      const promise = (async () => {
        const series = await activeClient.fetchDailySeries(ticker, range);
        const report = buildStockReport(series);
        // Reserve the expiry this entry will receive, then stamp source + cache
        // metadata and VALIDATE the completed public report. An invalid report
        // throws here — BEFORE `cache.set` — so it is never stored.
        const expiresAt = cache.peekExpiry();
        const validated = withMeta(report, false, expiresAt, dataMode);
        // Cache exactly the validated object, under the same expiry it carries.
        cache.set(key, validated, expiresAt);
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
