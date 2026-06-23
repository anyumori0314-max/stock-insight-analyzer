import type { SyncState, SyncResult } from "../domain/historical";
import type { SqlDatabase, SqlStatement } from "../db/sqlite";

/**
 * Per-ticker sync bookkeeping (`sync_state`): the latest stored trade date and
 * the outcome of the most recent sync attempt. Only SAFE, pre-redacted fields are
 * written — `last_error_code` is a stable public error code and
 * `safe_error_message` is an already-sanitized message, never a stack or provider
 * body.
 */

export interface RecordAttemptInput {
  ticker: string;
  attemptAt: string;
  result: SyncResult;
  latestTradeDate?: string | null;
  successAt?: string | null;
  errorCode?: string | null;
  safeErrorMessage?: string | null;
}

export interface SyncStateRepository {
  get(ticker: string): SyncState | null;
  /** Upserts the sync row for a ticker with the latest attempt's outcome. */
  recordAttempt(input: RecordAttemptInput): void;
}

function rowToState(row: Record<string, unknown>): SyncState {
  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    ticker: String(row.ticker),
    latestTradeDate: str(row.latest_trade_date),
    lastAttemptAt: str(row.last_attempt_at),
    lastSuccessAt: str(row.last_success_at),
    lastResult: str(row.last_result) as SyncResult | null,
    lastErrorCode: str(row.last_error_code),
    safeErrorMessage: str(row.safe_error_message),
  };
}

export function createSyncStateRepository(db: SqlDatabase): SyncStateRepository {
  const select: SqlStatement = db.prepare("SELECT * FROM sync_state WHERE ticker = ?");
  // On conflict, preserve the previous successful timestamp/date unless this
  // attempt supplies a newer one (COALESCE keeps the most recent success info).
  const upsert: SqlStatement = db.prepare(
    "INSERT INTO sync_state (ticker, latest_trade_date, last_attempt_at, last_success_at, last_result, last_error_code, safe_error_message) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(ticker) DO UPDATE SET " +
      "latest_trade_date = COALESCE(excluded.latest_trade_date, sync_state.latest_trade_date), " +
      "last_attempt_at = excluded.last_attempt_at, " +
      "last_success_at = COALESCE(excluded.last_success_at, sync_state.last_success_at), " +
      "last_result = excluded.last_result, " +
      "last_error_code = excluded.last_error_code, " +
      "safe_error_message = excluded.safe_error_message"
  );

  return {
    get(ticker) {
      const row = select.get(ticker);
      return row ? rowToState(row) : null;
    },
    recordAttempt(input) {
      upsert.run(
        input.ticker,
        input.latestTradeDate ?? null,
        input.attemptAt,
        input.successAt ?? null,
        input.result,
        input.errorCode ?? null,
        input.safeErrorMessage ?? null
      );
    },
  };
}
