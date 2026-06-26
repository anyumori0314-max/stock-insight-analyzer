import path from "path";
import dotenv from "dotenv";

import { loadEnv } from "../config/env";
import { openHistoricalStore } from "../db/store";
import { createBackfillService } from "../services/backfillService";
import { createCsvImportService } from "../services/csvImportService";
import { createDataCoverageService } from "../services/dataCoverageService";
import { runCli } from "../utils/cli";
import { createLogger } from "../utils/logger";

/**
 * `npm run data:backfill` — bulk-load a directory of historical price CSVs into
 * SQLite, then print per-ticker coverage.
 *
 *   npm run data:backfill -- --csv-directory "./data/history"
 *
 * Idempotent and resumable: every row is an UPSERT keyed by (ticker, trade_date),
 * each file imports in its own transaction, and a malformed file fails in
 * isolation (persisting nothing) while the rest still load — so re-running after a
 * partial failure is always safe.
 *
 * Exit codes (so a scheduler / CI can branch):
 *   0  every processed file succeeded (or the directory held no CSVs)
 *   1  at least one file failed validation (input error) or the directory is bad
 *   2  at least one file hit a database error
 *
 * NEVER logs absolute paths, row values, secrets or stacks — only safe, structured
 * fields (base file names, counts, ISO dates).
 */

const EXIT_OK = 0;
const EXIT_INPUT = 1;
const EXIT_DB = 2;

interface CliArgs {
  directory: string;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  let directory: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--csv-directory" || arg === "--directory") {
      directory = argv[++i];
    } else if (arg.startsWith("--csv-directory=")) {
      directory = arg.slice("--csv-directory=".length);
    } else if (arg.startsWith("--directory=")) {
      directory = arg.slice("--directory=".length);
    } else {
      return null; // unknown argument -> usage
    }
  }
  if (!directory) return null;
  return { directory };
}

function printUsage(): void {
  process.stderr.write(
    "Usage:\n" + '  npm run data:backfill -- --csv-directory "<CSV_DIRECTORY>"\n'
  );
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    printUsage();
    return EXIT_INPUT;
  }

  dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });
  const env = loadEnv();
  const logger = createLogger({ level: "info" });

  const store = openHistoricalStore({ location: env.STOCK_DB_PATH });
  try {
    const csvImportService = createCsvImportService({
      db: store.db,
      priceRepository: store.prices,
      importRunRepository: store.importRuns,
      limits: { maxRows: env.STOCK_IMPORT_MAX_ROWS, maxBytes: env.STOCK_IMPORT_MAX_BYTES },
      logger,
    });
    const backfill = createBackfillService({ csvImportService, logger });
    const coverageService = createDataCoverageService({
      priceRepository: store.prices,
      importRunRepository: store.importRuns,
      syncStateRepository: store.syncState,
    });

    const summary = backfill.run(args.directory);

    // Per-ticker coverage after the load (safe fields only).
    for (const coverage of coverageService.getAllCoverage()) {
      logger.info("backfill_coverage", {
        ticker: coverage.ticker,
        earliestTradeDate: coverage.earliestTradeDate,
        latestTradeDate: coverage.latestTradeDate,
        recordCount: coverage.recordCount,
        availableRanges: coverage.availableRanges.join(","),
        missingTradingDays: coverage.missingTradingDays,
      });
    }

    if (summary.hadDbError) return EXIT_DB;
    if (summary.filesFailed > 0) return EXIT_INPUT;
    return EXIT_OK;
  } finally {
    store.close();
  }
}

runCli(main);
