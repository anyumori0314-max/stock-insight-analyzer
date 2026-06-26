import path from "path";
import dotenv from "dotenv";

import { loadEnv } from "../config/env";
import { openHistoricalStore } from "../db/store";
import { createCsvImportService, type CsvImportResult } from "../services/csvImportService";
import { runCli } from "../utils/cli";
import { createLogger } from "../utils/logger";

/**
 * `npm run data:import` — validate + persist daily-price CSV(s) into SQLite.
 *
 *   npm run data:import -- --file "<CSV_PATH>"
 *   npm run data:import -- --directory "<CSV_DIRECTORY>"
 *
 * Exit codes (so a scheduler can branch):
 *   0  success (everything imported / unchanged)
 *   1  input error (usage, missing/invalid file, validation failure)
 *   2  database error
 *
 * NEVER logs absolute paths, row values, secrets or stacks — only safe, structured
 * fields (run id, base file name, counts).
 */

const EXIT_OK = 0;
const EXIT_INPUT = 1;
const EXIT_DB = 2;

interface CliArgs {
  file?: string;
  directory?: string;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      args.file = argv[++i];
    } else if (arg === "--directory") {
      args.directory = argv[++i];
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
    } else if (arg.startsWith("--directory=")) {
      args.directory = arg.slice("--directory=".length);
    } else {
      return null; // unknown argument -> usage
    }
  }
  if (!args.file && !args.directory) return null;
  return args;
}

function printUsage(): void {
  process.stderr.write(
    "Usage:\n" +
      '  npm run data:import -- --file "<CSV_PATH>"\n' +
      '  npm run data:import -- --directory "<CSV_DIRECTORY>"\n'
  );
}

function worstExitCode(results: readonly CsvImportResult[]): number {
  if (results.some((r) => r.status === "db_error")) return EXIT_DB;
  if (results.some((r) => r.status === "input_error")) return EXIT_INPUT;
  return EXIT_OK;
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
  const service = createCsvImportService({
    db: store.db,
    priceRepository: store.prices,
    importRunRepository: store.importRuns,
    limits: { maxRows: env.STOCK_IMPORT_MAX_ROWS, maxBytes: env.STOCK_IMPORT_MAX_BYTES },
    logger,
  });

  const results: CsvImportResult[] = [];
  try {
    if (args.file) {
      results.push(service.importFile(args.file));
    }
    if (args.directory) {
      const dirResults = service.importDirectory(args.directory);
      if (dirResults.length === 0) {
        logger.info("csv_import_completed", { reason: "no_csv_files", fileCount: 0 });
      }
      results.push(...dirResults);
    }
  } finally {
    store.close();
  }

  for (const r of results) {
    logger.info("csv_import_result", {
      sourceName: r.sourceName,
      status: r.status,
      rowsRead: r.rowsRead,
      rowsInserted: r.rowsInserted,
      rowsUpdated: r.rowsUpdated,
      rowsUnchanged: r.rowsUnchanged,
      rowsFailed: r.rowsFailed,
    });
  }

  return worstExitCode(results);
}

runCli(main);
