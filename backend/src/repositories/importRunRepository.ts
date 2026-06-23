import type {
  ImportRun,
  ImportRunCounts,
  ImportRunSourceType,
  ImportRunStatus,
} from "../domain/historical";
import type { SqlDatabase, SqlStatement } from "../db/sqlite";

/**
 * Append-only audit log of import / sync runs (`import_runs`).
 *
 * A run is opened with {@link ImportRunRepository.start} (status "started") and
 * later closed with {@link ImportRunRepository.finish} (status "completed" /
 * "failed") carrying row counts and a SAFE, pre-redacted error summary — never a
 * stack, a provider body or an absolute path.
 */

export interface StartRunInput {
  sourceType: ImportRunSourceType;
  /** A SAFE label only (e.g. a base file name) — callers must redact paths. */
  sourceName: string | null;
  startedAt: string;
}

export interface FinishRunInput extends Partial<ImportRunCounts> {
  status: Exclude<ImportRunStatus, "started">;
  finishedAt: string;
  safeErrorSummary?: string | null;
}

export interface ImportRunRepository {
  /** Opens a run row and returns its id. */
  start(input: StartRunInput): number;
  /** Closes a run with a terminal status, counts and an optional safe summary. */
  finish(id: number, input: FinishRunInput): void;
  /** Reads a run row by id (mainly for tests / status routes). */
  get(id: number): ImportRun | null;
  /** The most recent run for a source type, if any. */
  latest(sourceType?: ImportRunSourceType): ImportRun | null;
  /** The most recent COMPLETED run for a source type, if any. */
  latestCompleted(sourceType: ImportRunSourceType): ImportRun | null;
}

function rowToRun(row: Record<string, unknown>): ImportRun {
  return {
    id: Number(row.id),
    sourceType: String(row.source_type) as ImportRunSourceType,
    sourceName: row.source_name === null || row.source_name === undefined ? null : String(row.source_name),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : String(row.finished_at),
    status: String(row.status) as ImportRunStatus,
    rowsRead: Number(row.rows_read),
    rowsInserted: Number(row.rows_inserted),
    rowsUpdated: Number(row.rows_updated),
    rowsUnchanged: Number(row.rows_unchanged),
    rowsFailed: Number(row.rows_failed),
    safeErrorSummary:
      row.safe_error_summary === null || row.safe_error_summary === undefined
        ? null
        : String(row.safe_error_summary),
  };
}

export function createImportRunRepository(db: SqlDatabase): ImportRunRepository {
  const insert: SqlStatement = db.prepare(
    "INSERT INTO import_runs (source_type, source_name, started_at, status) VALUES (?, ?, ?, 'started')"
  );
  const update: SqlStatement = db.prepare(
    "UPDATE import_runs SET status = ?, finished_at = ?, rows_read = ?, rows_inserted = ?, " +
      "rows_updated = ?, rows_unchanged = ?, rows_failed = ?, safe_error_summary = ? WHERE id = ?"
  );
  const selectById: SqlStatement = db.prepare("SELECT * FROM import_runs WHERE id = ?");
  const selectLatestAny: SqlStatement = db.prepare(
    "SELECT * FROM import_runs ORDER BY id DESC LIMIT 1"
  );
  const selectLatestByType: SqlStatement = db.prepare(
    "SELECT * FROM import_runs WHERE source_type = ? ORDER BY id DESC LIMIT 1"
  );
  const selectLatestCompleted: SqlStatement = db.prepare(
    "SELECT * FROM import_runs WHERE source_type = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
  );

  return {
    start(input) {
      const result = insert.run(input.sourceType, input.sourceName, input.startedAt);
      return Number(result.lastInsertRowid);
    },
    finish(id, input) {
      update.run(
        input.status,
        input.finishedAt,
        input.rowsRead ?? 0,
        input.rowsInserted ?? 0,
        input.rowsUpdated ?? 0,
        input.rowsUnchanged ?? 0,
        input.rowsFailed ?? 0,
        input.safeErrorSummary ?? null,
        id
      );
    },
    get(id) {
      const row = selectById.get(id);
      return row ? rowToRun(row) : null;
    },
    latest(sourceType) {
      const row = sourceType ? selectLatestByType.get(sourceType) : selectLatestAny.get();
      return row ? rowToRun(row) : null;
    },
    latestCompleted(sourceType) {
      const row = selectLatestCompleted.get(sourceType);
      return row ? rowToRun(row) : null;
    },
  };
}
