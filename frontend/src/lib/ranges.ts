import type { StockReport } from "../types/stock";

/**
 * Supported analysis windows — must match `backend/src/types/stock.ts`.
 *
 * `1m` (~21d) and `3m` (~63d) are backed by every data mode, including the free
 * `TIME_SERIES_DAILY` compact feed. `6m` (~126d) and `1y` (~252d) are honestly
 * backed by the SQLite history store (the historical / hybrid modes and the CSV
 * backfill pipeline); in `live` mode the backend serves what the compact feed has
 * and attaches an explicit "available N business days" warning rather than
 * silently showing a shorter period. This list is the single source the UI
 * renders from.
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
  { value: "6m", label: "6か月" },
  { value: "1y", label: "1年" },
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
