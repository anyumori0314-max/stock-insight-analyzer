import type { HistoricalStore } from "../db/store";
import type { CsvImportResult, CsvImportService } from "./csvImportService";
import type { JobLock } from "./jobLock";
import type { MarketDataSyncService, SyncOutcome } from "./marketDataSyncService";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

/**
 * Orchestrates the daily maintenance job (Phase 14): single-instance guard →
 * (optional) CSV import → (optional) provider top-up per ticker → result audit.
 *
 * It is IDEMPOTENT and CRASH-SAFE: a second concurrent run is rejected by the
 * job lock; a failed CSV file changes no data (the import service is atomic per
 * file); a provider failure for one ticker is recorded and never aborts the
 * others. Every step emits a SAFE structured log event — no key, path, body or
 * stack. Exit codes let a scheduler branch (see {@link DAILY_EXIT}).
 */

export const DAILY_EXIT = {
  OK: 0,
  INPUT_ERROR: 1,
  DB_ERROR: 2,
  CONCURRENT: 3,
} as const;

export type DailyStatus = "completed" | "rejected" | "failed";

export interface DailyUpdateParams {
  /** Directory of CSVs to import first (optional). */
  csvDirectory?: string;
  /** Tickers to sync from the provider (optional; requires a sync service). */
  tickers: string[];
}

export interface DailyUpdateResult {
  status: DailyStatus;
  lock: "acquired" | "rejected";
  exitCode: number;
  importRunId: number | null;
  csv: {
    files: number;
    rowsInserted: number;
    rowsUpdated: number;
    rowsUnchanged: number;
    rowsFailed: number;
    failedFiles: number;
  };
  sync: {
    attempted: number;
    succeeded: number;
    skipped: number;
    failed: number;
  };
}

export interface DailyUpdateOptions {
  store: HistoricalStore;
  jobLock: JobLock;
  lockTimeoutSeconds: number;
  csvImportService?: CsvImportService;
  syncService?: MarketDataSyncService;
  logger?: Logger;
  now?: () => Date;
}

export interface DailyUpdateService {
  run(params: DailyUpdateParams): Promise<DailyUpdateResult>;
}

/** The job-lock name used for the daily update (exported for tests). */
export const DAILY_LOCK_NAME = "daily_stock_update";
const LOCK_NAME = DAILY_LOCK_NAME;

export function createDailyUpdateService(options: DailyUpdateOptions): DailyUpdateService {
  const { store, jobLock, lockTimeoutSeconds } = options;
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? (() => new Date());

  function summarizeCsv(results: CsvImportResult[]) {
    const csv = {
      files: results.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsFailed: 0,
      failedFiles: 0,
    };
    let dbError = false;
    let inputError = false;
    for (const r of results) {
      csv.rowsInserted += r.rowsInserted;
      csv.rowsUpdated += r.rowsUpdated;
      csv.rowsUnchanged += r.rowsUnchanged;
      csv.rowsFailed += r.rowsFailed;
      if (r.status !== "completed") csv.failedFiles += 1;
      if (r.status === "db_error") dbError = true;
      if (r.status === "input_error") inputError = true;
    }
    return { csv, dbError, inputError };
  }

  return {
    async run(params) {
      const runId = `${Date.now().toString(36)}`;
      const handle = jobLock.acquire(LOCK_NAME, { ttlSeconds: lockTimeoutSeconds });
      if (!handle) {
        // Another run holds a valid lock. Reject cleanly — never run concurrently.
        logger.warn("concurrent_job_rejected", { job: LOCK_NAME });
        return {
          status: "rejected",
          lock: "rejected",
          exitCode: DAILY_EXIT.CONCURRENT,
          importRunId: null,
          csv: { files: 0, rowsInserted: 0, rowsUpdated: 0, rowsUnchanged: 0, rowsFailed: 0, failedFiles: 0 },
          sync: { attempted: 0, succeeded: 0, skipped: 0, failed: 0 },
        };
      }

      const importRunId = store.importRuns.start({
        sourceType: "daily",
        sourceName: null,
        startedAt: now().toISOString(),
      });
      logger.info("daily_job_started", { runId, importRunId });

      let csvSummary = { files: 0, rowsInserted: 0, rowsUpdated: 0, rowsUnchanged: 0, rowsFailed: 0, failedFiles: 0 };
      const syncSummary = { attempted: 0, succeeded: 0, skipped: 0, failed: 0 };
      let exitCode: number = DAILY_EXIT.OK;

      try {
        // 1. CSV import (optional). Atomic per file; failures recorded, never fatal.
        if (params.csvDirectory && options.csvImportService) {
          const results = options.csvImportService.importDirectory(params.csvDirectory);
          const { csv, dbError, inputError } = summarizeCsv(results);
          csvSummary = csv;
          if (dbError) exitCode = DAILY_EXIT.DB_ERROR;
          else if (inputError && exitCode === DAILY_EXIT.OK) exitCode = DAILY_EXIT.INPUT_ERROR;
        }

        // 2. Provider top-up per ticker (optional). One ticker's failure does not
        //    abort the others; provider failures are EXPECTED and not job-fatal.
        if (options.syncService && params.tickers.length > 0) {
          for (const ticker of params.tickers) {
            syncSummary.attempted += 1;
            let outcome: SyncOutcome;
            try {
              outcome = await options.syncService.sync(ticker);
            } catch {
              syncSummary.failed += 1;
              continue;
            }
            if (outcome.result === "success") syncSummary.succeeded += 1;
            else if (outcome.result === "skipped") syncSummary.skipped += 1;
            else syncSummary.failed += 1;
          }
        }

        store.importRuns.finish(importRunId, {
          status: "completed",
          finishedAt: now().toISOString(),
          rowsRead: csvSummary.rowsInserted + csvSummary.rowsUpdated + csvSummary.rowsUnchanged + csvSummary.rowsFailed,
          rowsInserted: csvSummary.rowsInserted,
          rowsUpdated: csvSummary.rowsUpdated,
          rowsUnchanged: csvSummary.rowsUnchanged,
          rowsFailed: csvSummary.rowsFailed,
        });
        logger.info("daily_job_completed", {
          runId,
          importRunId,
          csvFiles: csvSummary.files,
          rowsInserted: csvSummary.rowsInserted,
          syncSucceeded: syncSummary.succeeded,
          syncFailed: syncSummary.failed,
        });

        return {
          status: "completed",
          lock: "acquired",
          exitCode,
          importRunId,
          csv: csvSummary,
          sync: syncSummary,
        };
      } catch {
        // Unexpected failure: record a safe summary and report a DB-error exit.
        store.importRuns.finish(importRunId, {
          status: "failed",
          finishedAt: now().toISOString(),
          safeErrorSummary: "日次ジョブの実行中に予期しないエラーが発生しました。",
        });
        logger.error("daily_job_failed", { runId, importRunId });
        return {
          status: "failed",
          lock: "acquired",
          exitCode: DAILY_EXIT.DB_ERROR,
          importRunId,
          csv: csvSummary,
          sync: syncSummary,
        };
      } finally {
        // Always release the lock so a crash never leaves it held.
        jobLock.release(handle);
      }
    },
  };
}
