import type { CsvImportResult, CsvImportService } from "./csvImportService";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

/**
 * Bulk-loads a directory of historical price CSVs into SQLite (Phase 16).
 *
 * It is a THIN orchestration layer over {@link CsvImportService.importDirectory}
 * so the idempotent, atomic, per-file (= per-ticker under the recommended
 * one-file-per-ticker layout) import semantics are reused verbatim — no second
 * copy of the parse/validate/upsert logic. Each file is its own transaction, so a
 * single malformed file fails in isolation (persisting NOTHING) while the rest
 * still load; re-running after a partial failure is safe because every row is an
 * UPSERT keyed by (ticker, trade_date) and unchanged rows are reported as such.
 *
 * The summary aggregates processed / succeeded / failed file counts and the total
 * inserted / updated / unchanged / failed row counts, so an operator (or CI smoke
 * test) gets one structured result. Only SAFE values cross the boundary: the
 * underlying results carry base file names and pre-redacted summaries, never
 * absolute paths, row values or secrets.
 */

export type BackfillStatus = "completed" | "partial" | "failed" | "empty";

export interface BackfillSummary {
  status: BackfillStatus;
  filesProcessed: number;
  /** Files whose import completed (fully valid, persisted or unchanged). */
  filesSucceeded: number;
  /** Files rejected before/at persistence (validation or DB error). */
  filesFailed: number;
  rowsRead: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsFailed: number;
  /** True when any file ended in a database (not input) error. */
  hadDbError: boolean;
  /** Per-file results, in import (sorted) order. */
  results: CsvImportResult[];
}

export interface BackfillService {
  /** Imports every `*.csv` directly inside `directory` and aggregates the result. */
  run(directory: string): BackfillSummary;
}

export interface BackfillServiceOptions {
  csvImportService: CsvImportService;
  logger?: Logger;
}

function classify(results: readonly CsvImportResult[]): BackfillStatus {
  if (results.length === 0) {
    return "empty";
  }
  const succeeded = results.filter((r) => r.status === "completed").length;
  if (succeeded === results.length) {
    return "completed";
  }
  if (succeeded === 0) {
    return "failed";
  }
  return "partial";
}

export function createBackfillService(options: BackfillServiceOptions): BackfillService {
  const { csvImportService } = options;
  const logger = options.logger ?? silentLogger;

  return {
    run(directory: string): BackfillSummary {
      logger.info("backfill_started", {});
      const results = csvImportService.importDirectory(directory);

      const summary: BackfillSummary = {
        status: classify(results),
        filesProcessed: results.length,
        filesSucceeded: results.filter((r) => r.status === "completed").length,
        filesFailed: results.filter((r) => r.status !== "completed").length,
        rowsRead: 0,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsFailed: 0,
        hadDbError: results.some((r) => r.status === "db_error"),
        results,
      };

      for (const r of results) {
        summary.rowsRead += r.rowsRead;
        summary.rowsInserted += r.rowsInserted;
        summary.rowsUpdated += r.rowsUpdated;
        summary.rowsUnchanged += r.rowsUnchanged;
        summary.rowsFailed += r.rowsFailed;
        // One structured line per file so progress is visible without leaking
        // anything sensitive (sourceName is a base file name only).
        logger.info("backfill_file", {
          sourceName: r.sourceName,
          status: r.status,
          rowsRead: r.rowsRead,
          rowsInserted: r.rowsInserted,
          rowsUpdated: r.rowsUpdated,
          rowsUnchanged: r.rowsUnchanged,
          rowsFailed: r.rowsFailed,
        });
      }

      logger.info("backfill_completed", {
        status: summary.status,
        filesProcessed: summary.filesProcessed,
        filesSucceeded: summary.filesSucceeded,
        filesFailed: summary.filesFailed,
        rowsInserted: summary.rowsInserted,
        rowsUpdated: summary.rowsUpdated,
        rowsUnchanged: summary.rowsUnchanged,
        rowsFailed: summary.rowsFailed,
      });

      return summary;
    },
  };
}
