import { buildStockReport } from "../analytics/report";
import { ApiError } from "../types/errors";
import type { StockReport } from "../types/report";
import {
  createAlphaVantageClient,
  DEFAULT_RANGE,
  type AlphaVantageClient,
} from "./alphaVantageClient";
import { createTtlCache, type TtlCache } from "./ttlCache";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

export interface StockService {
  /** Returns the analyzed report for a (already validated) ticker + range. */
  getReport(ticker: string, range?: string): Promise<StockReport>;
}

export interface StockServiceOptions {
  /** Alpha Vantage key. When absent (and no `client` is injected), requests
   * fail with `API_KEY_MISSING` instead of crashing app startup. */
  apiKey?: string;
  /** Pre-built client (tests inject a fake; avoids network + real key). */
  client?: AlphaVantageClient;
  /** Pre-built cache (tests inject one with a controllable clock). */
  cache?: TtlCache<StockReport>;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  /** Outbound per-request timeout, forwarded when building the default client. */
  timeoutMs?: number;
}

function cacheKey(ticker: string, range: string): string {
  return `${ticker}:${range}`;
}

/** Returns a copy of the report with its cache metadata stamped in. */
function withCacheMeta(report: StockReport, hit: boolean, expiresAtMs: number): StockReport {
  return {
    ...report,
    cache: { hit, expiresAt: new Date(expiresAtMs).toISOString() },
  };
}

/**
 * Orchestrates the stock data flow:
 *   - cache hit  -> serve immediately (no provider call), `cache.hit = true`.
 *   - in-flight  -> coalesce concurrent requests for the same key onto one
 *                   provider call (dedup map), so 10 simultaneous requests for
 *                   AAPL hit Alpha Vantage exactly once.
 *   - miss       -> fetch + analyze, cache the successful result, return it.
 *
 * Only successful results are cached. Errors (and the in-flight promise) are
 * always cleared in `finally`, so a failure never poisons the cache and the
 * next request retries cleanly.
 */
export function createStockService(options: StockServiceOptions = {}): StockService {
  const cache =
    options.cache ??
    createTtlCache<StockReport>({
      ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      maxEntries: options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
    });

  let client: AlphaVantageClient | undefined = options.client;
  if (!client && options.apiKey) {
    client = createAlphaVantageClient({ apiKey: options.apiKey, timeoutMs: options.timeoutMs });
  }

  const inflight = new Map<string, Promise<{ report: StockReport; expiresAt: number }>>();

  return {
    async getReport(ticker: string, range: string = DEFAULT_RANGE): Promise<StockReport> {
      if (!client) {
        throw new ApiError(
          503,
          "API_KEY_MISSING",
          "Stock data is temporarily unavailable. The market data API key is not configured."
        );
      }

      const key = cacheKey(ticker, range);

      const cached = cache.getWithMeta(key);
      if (cached) {
        return withCacheMeta(cached.value, true, cached.expiresAt);
      }

      const existing = inflight.get(key);
      if (existing) {
        const { report, expiresAt } = await existing;
        return withCacheMeta(report, false, expiresAt);
      }

      const activeClient = client;
      const promise = (async () => {
        const series = await activeClient.fetchDailySeries(ticker, range);
        const report = buildStockReport(series);
        const expiresAt = cache.set(key, report); // cache only on success
        return { report, expiresAt };
      })();
      inflight.set(key, promise);

      try {
        const { report, expiresAt } = await promise;
        return withCacheMeta(report, false, expiresAt);
      } finally {
        inflight.delete(key);
      }
    },
  };
}
