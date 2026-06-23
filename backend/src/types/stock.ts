/**
 * Internal, provider-agnostic stock domain types.
 *
 * The raw Alpha Vantage payload is validated, cross-checked and mapped into
 * these types in the client layer, so nothing downstream depends on Alpha
 * Vantage's string-keyed wire format.
 */

/**
 * Supported analysis windows.
 *
 * The free `TIME_SERIES_DAILY` feed is requested with `outputsize=compact`, which
 * returns only the latest ~100 trading days. We therefore expose ONLY the windows
 * that the compact feed can FULLY and HONESTLY back: `1m` (~21d) and `3m` (~63d).
 *
 * `6m` (~126d) and `1y` (~252d) are intentionally NOT supported: the compact feed
 * cannot reach that far back, and presenting the same ~100 bars as "6 months" or
 * "1 year" would be misleading. They are removed from this union, so the zod enum
 * rejects them at runtime (`INVALID_RANGE`) and the UI never offers them. (Real
 * 6m/1y support would require `outputsize=full`; that is a deliberate future
 * change, documented in the README, not silently faked here.)
 */
export const STOCK_RANGES = ["1m", "3m"] as const;
export type StockRange = (typeof STOCK_RANGES)[number];

/** Default window: fully covered by the compact feed and long enough for SMA50. */
export const DEFAULT_RANGE: StockRange = "3m";

/**
 * Approximate US trading days per window (~21 sessions/month). The service slices
 * the compact series to the last N bars for the requested window, so `1m` and
 * `3m` always return genuinely different periods from the same compact fetch.
 */
export const RANGE_TRADING_DAYS: Record<StockRange, number> = {
  "1m": 21,
  "3m": 63,
};

/** Human-readable (Japanese) window labels, for warnings and the UI. */
export const RANGE_LABEL: Record<StockRange, string> = {
  "1m": "1か月",
  "3m": "3か月",
};

/** Runtime guard for an arbitrary value being a supported range. */
export function isStockRange(value: unknown): value is StockRange {
  return typeof value === "string" && (STOCK_RANGES as readonly string[]).includes(value);
}

/**
 * The data-serving mode for a report:
 *   live       = Alpha Vantage directly (Phase 2–11 path).
 *   mock       = deterministic in-process fixtures (no traffic, no DB).
 *   historical = SQLite history store only (no traffic).
 *   hybrid     = SQLite first, provider-supplemented when stale (DB fallback).
 *
 * Defined here (a dependency-free module) so the service, the persistent cache and
 * the historical pipeline can all reference it without a circular import. The
 * persistent cache uses it to keep entries from different modes separated.
 */
export type StockDataMode = "live" | "mock" | "historical" | "hybrid";

export const STOCK_DATA_MODES: readonly StockDataMode[] = [
  "live",
  "mock",
  "historical",
  "hybrid",
] as const;

/** A single day's OHLCV bar. All numeric, already parsed and validated. */
export interface DailyBar {
  /** Trading day in ISO `YYYY-MM-DD` form. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /**
   * Split/dividend-adjusted close. `TIME_SERIES_DAILY` (the free endpoint) does
   * NOT provide this, so it is always `null` here; `priceBasis` is "close".
   */
  adjustedClose: number | null;
  volume: number;
}

/**
 * A normalized daily time series for one ticker, sorted oldest -> newest so
 * indicator math and charting can iterate forward in time.
 */
export interface StockTimeSeries {
  ticker: string;
  /** Logical window identifier (`1m` / `3m`). */
  range: StockRange;
  /** Provider currency, if known. `TIME_SERIES_DAILY` does not report it -> null. */
  currency: string | null;
  /** Provider time zone label (e.g. "US/Eastern"), or null if absent. */
  timezone: string | null;
  /** Provider's "Last Refreshed" timestamp, or null if absent. */
  lastRefreshed: string | null;
  /** Which price field downstream metrics are based on. */
  priceBasis: "close" | "adjusted";
  /** Ascending by date, de-duplicated, cross-field validated. */
  bars: DailyBar[];
  /** Non-fatal notes raised while validating/normalizing the response. */
  warnings: string[];
}
