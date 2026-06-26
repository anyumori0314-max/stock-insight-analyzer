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
 * Short windows `1m` (~21d) and `3m` (~63d) are fully backed by EVERY data mode,
 * including the free `TIME_SERIES_DAILY` compact feed (latest ~100 trading days).
 *
 * Long windows `6m` (~126d) and `1y` (~252d) are honestly backed only by the
 * SQLite history store (the `historical` / `hybrid` modes) and the CSV backfill
 * pipeline (Phase 16). The live compact feed cannot reach that far back, so when a
 * long window is requested in `live` mode the service slices what is available and
 * raises an EXPLICIT, non-fatal warning naming the wanted vs. available bar count
 * (see `sliceSeriesToRange`) — it never silently presents ~100 bars as a year.
 *
 * Windows are managed as this single literal union (mirrored by the zod
 * `rangeQuerySchema` enum and the public report schema), so any other value is
 * rejected at runtime as `INVALID_RANGE` and the UI only ever offers these four.
 */
export const STOCK_RANGES = ["1m", "3m", "6m", "1y"] as const;
export type StockRange = (typeof STOCK_RANGES)[number];

/** Default window: fully covered by the compact feed and long enough for SMA50. */
export const DEFAULT_RANGE: StockRange = "3m";

/**
 * Approximate US trading days per window (~21 sessions/month, ~252/year). The
 * service slices the available series to the last N bars for the requested window,
 * so every window returns a genuinely different period; the long windows draw on
 * the deeper SQLite history rather than the ~100-bar compact feed.
 */
export const RANGE_TRADING_DAYS: Record<StockRange, number> = {
  "1m": 21,
  "3m": 63,
  "6m": 126,
  "1y": 252,
};

/** Human-readable (Japanese) window labels, for warnings and the UI. */
export const RANGE_LABEL: Record<StockRange, string> = {
  "1m": "1か月",
  "3m": "3か月",
  "6m": "6か月",
  "1y": "1年",
};

/** The largest supported window, in trading days (drives history fetch bounds). */
export const MAX_RANGE_TRADING_DAYS = Math.max(...Object.values(RANGE_TRADING_DAYS));

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
