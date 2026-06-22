import type { StockReport } from "../types/stock";

/**
 * Supported analysis windows — must match `backend/src/types/stock.ts`.
 *
 * The free `TIME_SERIES_DAILY` compact feed returns only ~100 trading days, so
 * only `1m` (~21d) and `3m` (~63d) can be honestly backed — and they return
 * genuinely different periods. `6m` / `1y` are intentionally NOT offered (the
 * compact feed cannot reach that far back; presenting the same ~100 bars as a
 * year would be misleading). The backend rejects them with `INVALID_RANGE`, and
 * this list — the single source the UI renders from — never offers them.
 */
export type StockRange = StockReport["range"];

export interface RangeOption {
  value: StockRange;
  /** Short button label. */
  label: string;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { value: "1m", label: "1か月" },
  { value: "3m", label: "3か月" },
];

/** Default window: fully covered by the feed and long enough for SMA50. */
export const DEFAULT_RANGE: StockRange = "3m";

const RANGE_VALUES = RANGE_OPTIONS.map((option) => option.value);

export function isStockRange(value: unknown): value is StockRange {
  return typeof value === "string" && (RANGE_VALUES as string[]).includes(value);
}

export function rangeLabel(range: StockRange): string {
  return RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
}
