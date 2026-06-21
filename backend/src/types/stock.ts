/**
 * Internal, provider-agnostic stock domain types.
 *
 * The raw Alpha Vantage payload is validated, cross-checked and mapped into
 * these types in the client layer, so nothing downstream depends on Alpha
 * Vantage's string-keyed wire format.
 */

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
  /** Logical window identifier (e.g. "100d" for compact daily). */
  range: string;
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
