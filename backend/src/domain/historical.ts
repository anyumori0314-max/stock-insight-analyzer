/**
 * Domain types for the historical-data pipeline (Phase 12–15).
 *
 * These are storage- and provider-agnostic: the SQLite repositories, the CSV
 * import service, the sync service and the report assembly all speak in terms of
 * these types, so swapping the persistence engine (or the upstream provider) is a
 * localized change. Nothing here imports a database driver or `fetch`.
 */

import type { StockDataMode } from "../types/stock";
import { STOCK_DATA_MODES } from "../types/stock";

/**
 * How a stored price bar originated. A bounded allow-list (mirrored by the
 * `price_bars.source` CHECK constraint) so a stray value can never be persisted.
 *  - csv  : imported from an operator-provided CSV file.
 *  - api  : supplemented from the upstream market-data provider (Alpha Vantage).
 *  - mock : produced by the deterministic in-process provider (development only).
 */
export type PriceSource = "csv" | "api" | "mock";

export const PRICE_SOURCES: readonly PriceSource[] = ["csv", "api", "mock"] as const;

export function isPriceSource(value: unknown): value is PriceSource {
  return typeof value === "string" && (PRICE_SOURCES as readonly string[]).includes(value);
}

/**
 * The data-serving mode for a request. Aliased from the dependency-free
 * `types/stock` module so there is a single source of truth (mock / historical /
 * hybrid / live); see {@link StockDataMode} for the per-mode semantics.
 */
export type DataMode = StockDataMode;
export const DATA_MODES: readonly DataMode[] = STOCK_DATA_MODES;

/** Where the latest bars served in a response actually came from. */
export type DataSourceKind = "mock" | "sqlite" | "csv" | "api";

/**
 * A single persisted daily OHLCV bar (the SQLite `price_bars` row), already
 * validated. `tradeDate` is a real `YYYY-MM-DD` calendar day; every price is a
 * positive finite number; `volume` is a non-negative safe integer.
 */
export interface PriceBar {
  ticker: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number | null;
  volume: number;
  currency: string | null;
  source: PriceSource;
}

/** The outcome of one import/sync run, recorded in `import_runs`. */
export type ImportRunStatus = "started" | "completed" | "failed";
export type ImportRunSourceType = "csv" | "api" | "daily";

export interface ImportRunCounts {
  rowsRead: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsFailed: number;
}

export interface ImportRun extends ImportRunCounts {
  id: number;
  sourceType: ImportRunSourceType;
  /** A SAFE label (e.g. a base file name) — never an absolute path or secret. */
  sourceName: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: ImportRunStatus;
  /** Public, redacted error summary only — never a stack or provider body. */
  safeErrorSummary: string | null;
}

/** Per-ticker sync bookkeeping (the `sync_state` row). */
export type SyncResult = "success" | "skipped" | "failed" | "no_data";

export interface SyncState {
  ticker: string;
  latestTradeDate: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastResult: SyncResult | null;
  lastErrorCode: string | null;
  /** Public, redacted message only. */
  safeErrorMessage: string | null;
}

/**
 * A computed freshness verdict for a (ticker, range) served from SQLite. Drives
 * the Phase 15 data-status UI and the Phase 13 "do we need to sync?" decision.
 */
export interface DataFreshness {
  latestTradeDate: string | null;
  recordCount: number;
  /** True when the newest stored bar is older than the staleness threshold. */
  stale: boolean;
  /** Hours since the newest stored bar (null when there is no data). */
  ageHours: number | null;
}

/**
 * Per-ticker history coverage (Phase 16). Describes how much stored data exists
 * for one symbol and which analysis windows it can fully back, plus the latest
 * CSV-import and API-sync timestamps. SAFE for surfacing in an operations report
 * or a status endpoint — no paths, stacks or key state.
 */
export interface TickerCoverage {
  ticker: string;
  earliestTradeDate: string | null;
  latestTradeDate: string | null;
  /** Number of stored bars for the ticker (raw row count, weekends included). */
  recordCount: number;
  /**
   * Windows whose required trading-day count is fully met by the stored
   * TRADING-day count (weekends, holidays, duplicate, invalid and future dates
   * excluded — NOT the raw `recordCount`), e.g. `1y` needs ~252 sessions. Ordered
   * shortest -> longest.
   */
  availableRanges: import("../types/stock").StockRange[];
  /**
   * Estimated number of regular trading sessions BETWEEN the earliest and latest
   * stored bar that are NOT present (expected sessions minus stored count, clamped
   * to >= 0). Zero when there is no gap (or fewer than two bars).
   */
  missingTradingDays: number;
  /** ISO instant of the most recent COMPLETED CSV import (any ticker), or null. */
  lastCsvImportedAt: string | null;
  /** ISO instant of the most recent successful API sync for THIS ticker, or null. */
  lastApiSyncedAt: string | null;
}

/**
 * Safe, public-facing metadata describing where a served report's data came
 * from and how fresh it is. Serialized onto `StockReport.dataStatus`. It contains
 * NO internal paths, stacks, provider bodies or API-key state.
 */
export interface DataSourceMetadata {
  dataMode: DataMode;
  dataSource: DataSourceKind;
  latestTradeDate: string | null;
  /** When this response's data was last (re)built, as an ISO-8601 UTC instant. */
  lastUpdatedAt: string | null;
  csvImportedAt: string | null;
  apiSyncedAt: string | null;
  /** True when the data is backed by the durable SQLite store. */
  persistent: boolean;
  stale: boolean;
  /** True when a provider failure forced a fall back to stored data. */
  fallbackUsed: boolean;
  recordCount: number;
}
