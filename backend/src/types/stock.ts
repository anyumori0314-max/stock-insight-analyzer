/**
 * Internal, provider-agnostic stock domain types.
 *
 * The raw Alpha Vantage payload is validated, cross-checked and mapped into
 * these types in the client layer, so nothing downstream depends on Alpha
 * Vantage's string-keyed wire format.
 */

/**
 * The single window the MVP supports. `outputsize=compact` returns ~100 trading
 * days, so the only logical range is `"100d"`. Kept as a literal (not `string`)
 * so the type system rejects unsupported ranges like `"1y"` at compile time.
 */
export type StockRange = "100d";

/** The default (and currently only) supported range. */
export const SUPPORTED_RANGE: StockRange = "100d";

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
  /** Logical window identifier. MVP supports only `"100d"` (compact daily). */
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
