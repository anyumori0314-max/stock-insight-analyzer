import fs from "fs";
import path from "path";

import type { ImportRunCounts } from "../domain/historical";
import type { SqlDatabase } from "../db/sqlite";
import type { ImportRunRepository } from "../repositories/importRunRepository";
import type { PriceRepository } from "../repositories/priceRepository";
import { parsePriceCsv, type PriceRowError } from "../csv/parsePriceCsv";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

/**
 * Validates a price-bar CSV and persists it to SQLite IDEMPOTENTLY and ATOMICALLY
 * (Phase 12).
 *
 * Flow: parse + validate the WHOLE file first; if anything is wrong, record a
 * failed `import_runs` row and change NO price data. Only a fully-valid file is
 * upserted, inside a single transaction, so a partial import is impossible.
 * Re-importing the same file reports every row as "unchanged".
 *
 * Only SAFE values cross the boundary: error summaries are pre-redacted and the
 * recorded `source_name` is a base file name, never an absolute path.
 */

export interface CsvImportLimits {
  maxRows: number;
  maxBytes: number;
}

/** A stable, exit-code-friendly classification of an import outcome. */
export type CsvImportStatus = "completed" | "input_error" | "db_error";

export interface CsvImportResult extends ImportRunCounts {
  status: CsvImportStatus;
  /** A safe base file name (never an absolute path). */
  sourceName: string;
  importRunId: number | null;
  /** Safe, line-numbered validation errors (empty unless input_error). */
  errors: PriceRowError[];
  /** Safe summary suitable for logs / a status response. */
  safeErrorSummary: string | null;
  unknownHeaders: string[];
}

export interface CsvImportServiceOptions {
  db: SqlDatabase;
  priceRepository: PriceRepository;
  importRunRepository: ImportRunRepository;
  limits: CsvImportLimits;
  logger?: Logger;
  now?: () => Date;
}

export interface CsvImportService {
  /** Validates + persists a single CSV file by path. */
  importFile(filePath: string): CsvImportResult;
  /**
   * Imports every `*.csv` file directly inside a directory (no recursion, no
   * symlink following), in sorted order. A missing / non-directory path yields a
   * single input-error result; an empty directory yields an empty array.
   */
  importDirectory(directory: string): CsvImportResult[];
  /** Validates + persists already-read CSV text (used by tests / the directory walk). */
  importContent(content: string, sourceName: string): CsvImportResult;
}

const ALLOWED_EXTENSION = ".csv";

/** Builds a compact, safe summary of validation errors (first few only). */
function summarizeErrors(errors: PriceRowError[]): string {
  if (errors.length === 0) return "検証エラー";
  const head = errors
    .slice(0, 5)
    .map((e) => `${e.line}行目: ${e.reason}`)
    .join(" / ");
  return errors.length > 5 ? `${head} ほか${errors.length - 5}件` : head;
}

export function createCsvImportService(options: CsvImportServiceOptions): CsvImportService {
  const { db, priceRepository, importRunRepository, limits } = options;
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? (() => new Date());

  function importContent(content: string, sourceName: string): CsvImportResult {
    const startedAt = now().toISOString();
    const importRunId = importRunRepository.start({
      sourceType: "csv",
      sourceName,
      startedAt,
    });
    logger.info("csv_import_started", { runId: importRunId, sourceName });

    const parsed = parsePriceCsv(content, { maxRows: limits.maxRows });

    // Whole-file or row-level validation failure: persist NOTHING.
    if (parsed.fatalError || parsed.errors.length > 0) {
      const safeErrorSummary = parsed.fatalError ?? summarizeErrors(parsed.errors);
      importRunRepository.finish(importRunId, {
        status: "failed",
        finishedAt: now().toISOString(),
        rowsRead: parsed.rowsRead,
        rowsFailed: parsed.fatalError ? parsed.rowsRead : parsed.errors.length,
        safeErrorSummary,
      });
      logger.warn("csv_import_failed", {
        runId: importRunId,
        sourceName,
        rowsRead: parsed.rowsRead,
        rowsFailed: parsed.fatalError ? parsed.rowsRead : parsed.errors.length,
      });
      return {
        status: "input_error",
        sourceName,
        importRunId,
        rowsRead: parsed.rowsRead,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsFailed: parsed.fatalError ? parsed.rowsRead : parsed.errors.length,
        errors: parsed.errors,
        safeErrorSummary,
        unknownHeaders: parsed.unknownHeaders,
      };
    }

    // Fully valid: upsert every bar atomically.
    const importedAt = now().toISOString();
    try {
      const counts = db.transaction(() =>
        priceRepository.upsertBars(parsed.bars, importedAt, importedAt)
      );
      importRunRepository.finish(importRunId, {
        status: "completed",
        finishedAt: now().toISOString(),
        rowsRead: parsed.rowsRead,
        rowsInserted: counts.inserted,
        rowsUpdated: counts.updated,
        rowsUnchanged: counts.unchanged,
        rowsFailed: 0,
      });
      logger.info("csv_import_completed", {
        runId: importRunId,
        sourceName,
        rowsRead: parsed.rowsRead,
        rowsInserted: counts.inserted,
        rowsUpdated: counts.updated,
        rowsUnchanged: counts.unchanged,
      });
      return {
        status: "completed",
        sourceName,
        importRunId,
        rowsRead: parsed.rowsRead,
        rowsInserted: counts.inserted,
        rowsUpdated: counts.updated,
        rowsUnchanged: counts.unchanged,
        rowsFailed: 0,
        errors: [],
        safeErrorSummary: null,
        unknownHeaders: parsed.unknownHeaders,
      };
    } catch {
      // The transaction rolled back; no rows were persisted.
      importRunRepository.finish(importRunId, {
        status: "failed",
        finishedAt: now().toISOString(),
        rowsRead: parsed.rowsRead,
        rowsFailed: parsed.rowsRead,
        safeErrorSummary: "データベース書き込みエラー",
      });
      logger.error("csv_import_failed", { runId: importRunId, sourceName, reason: "db_error" });
      return {
        status: "db_error",
        sourceName,
        importRunId,
        rowsRead: parsed.rowsRead,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsFailed: parsed.rowsRead,
        errors: [],
        safeErrorSummary: "データベース書き込みエラー",
        unknownHeaders: parsed.unknownHeaders,
      };
    }
  }

  function importFile(filePath: string): CsvImportResult {
    const sourceName = path.basename(filePath);
    // Reject anything that is not a real, regular .csv file. lstat (not stat) so a
    // symlink is detected and refused rather than silently followed.
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(filePath);
    } catch {
      return inputError(sourceName, "ファイルが見つかりません。");
    }
    if (stats.isSymbolicLink()) {
      return inputError(sourceName, "シンボリックリンクは読み込めません。");
    }
    if (!stats.isFile()) {
      return inputError(sourceName, "通常ファイルではありません。");
    }
    if (path.extname(filePath).toLowerCase() !== ALLOWED_EXTENSION) {
      return inputError(sourceName, "拡張子が .csv ではありません。");
    }
    if (stats.size > limits.maxBytes) {
      return inputError(sourceName, `ファイルサイズが上限（${limits.maxBytes}バイト）を超えています。`);
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return inputError(sourceName, "ファイルを読み込めませんでした。");
    }
    return importContent(content, sourceName);
  }

  function importDirectory(directory: string): CsvImportResult[] {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(directory);
    } catch {
      return [inputError(path.basename(directory), "ディレクトリが見つかりません。")];
    }
    if (!stats.isDirectory()) {
      return [inputError(path.basename(directory), "ディレクトリではありません。")];
    }
    const files = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === ALLOWED_EXTENSION)
      .map((e) => path.join(directory, e.name))
      .sort();
    return files.map((file) => importFile(file));
  }

  /** Records and returns a pre-validation input error (no DB price change). */
  function inputError(sourceName: string, reason: string): CsvImportResult {
    const startedAt = now().toISOString();
    const importRunId = importRunRepository.start({
      sourceType: "csv",
      sourceName,
      startedAt,
    });
    importRunRepository.finish(importRunId, {
      status: "failed",
      finishedAt: now().toISOString(),
      safeErrorSummary: reason,
    });
    logger.warn("csv_import_failed", { runId: importRunId, sourceName, reason: "input_error" });
    return {
      status: "input_error",
      sourceName,
      importRunId,
      rowsRead: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsFailed: 0,
      errors: [],
      safeErrorSummary: reason,
      unknownHeaders: [],
    };
  }

  return { importFile, importDirectory, importContent };
}
