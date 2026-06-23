import path from "path";
import dotenv from "dotenv";

import { loadEnv, type Env } from "../config/env";
import { openHistoricalStore } from "../db/store";
import { tickerSchema } from "../schemas/stock";
import { createAlphaVantageClient } from "../services/alphaVantageClient";
import { createCsvImportService } from "../services/csvImportService";
import { createDailyUpdateService, DAILY_EXIT } from "../services/dailyUpdateService";
import { createJobLock } from "../services/jobLock";
import { createMarketDataSyncService } from "../services/marketDataSyncService";
import { createLogger } from "../utils/logger";

/**
 * `npm run data:daily` — the scheduled daily maintenance job.
 *
 *   npm run data:daily
 *   npm run data:daily -- --csv-directory "<PATH>"
 *   npm run data:daily -- --tickers "AAPL,MSFT,NVDA"
 *
 * Steps: single-instance guard → CSV import → provider top-up → audit. The
 * provider step runs ONLY when a real API key is configured AND the data mode is
 * hybrid/live; otherwise the job imports CSVs and performs NO external calls.
 *
 * Exit codes: 0 ok · 1 input error · 2 db error · 3 concurrent run rejected.
 */

interface CliArgs {
  csvDirectory?: string;
  tickers?: string;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--csv-directory") args.csvDirectory = argv[++i];
    else if (arg.startsWith("--csv-directory=")) args.csvDirectory = arg.slice("--csv-directory=".length);
    else if (arg === "--tickers") args.tickers = argv[++i];
    else if (arg.startsWith("--tickers=")) args.tickers = arg.slice("--tickers=".length);
    else return null;
  }
  return args;
}

/** Normalizes a comma list of tickers, dropping any that fail validation. */
function resolveTickers(raw: string | undefined, env: Env): string[] {
  const source = raw
    ? raw.split(",").map((t) => t.trim()).filter(Boolean)
    : env.STOCK_SYNC_TICKERS;
  const valid: string[] = [];
  for (const candidate of source) {
    const result = tickerSchema.safeParse(candidate);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(
      'Usage: npm run data:daily -- [--csv-directory "<PATH>"] [--tickers "AAPL,MSFT"]\n'
    );
    return DAILY_EXIT.INPUT_ERROR;
  }

  dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

  let env: Env;
  try {
    env = loadEnv();
  } catch {
    // Never echo the offending values — loadEnv already redacts them.
    process.stderr.write("Invalid environment configuration. See .env.example.\n");
    return DAILY_EXIT.INPUT_ERROR;
  }

  const logger = createLogger({ level: "info" });
  const store = openHistoricalStore({ location: env.STOCK_DB_PATH });

  const csvImportService = createCsvImportService({
    db: store.db,
    priceRepository: store.prices,
    importRunRepository: store.importRuns,
    limits: { maxRows: env.STOCK_IMPORT_MAX_ROWS, maxBytes: env.STOCK_IMPORT_MAX_BYTES },
    logger,
  });

  // Provider top-up only with a real key AND a provider-backed mode. Otherwise the
  // job performs ZERO external calls (CSV import only).
  const providerEnabled =
    (env.STOCK_DATA_MODE === "hybrid" || env.STOCK_DATA_MODE === "live") &&
    Boolean(env.ALPHA_VANTAGE_API_KEY);
  const syncService = providerEnabled
    ? createMarketDataSyncService({
        provider: createAlphaVantageClient({
          apiKey: env.ALPHA_VANTAGE_API_KEY!,
          timeoutMs: env.ALPHA_VANTAGE_TIMEOUT_MS,
          maxPoints: env.ALPHA_VANTAGE_MAX_POINTS,
        }),
        db: store.db,
        priceRepository: store.prices,
        syncStateRepository: store.syncState,
        staleAfterHours: env.STOCK_STALE_AFTER_HOURS,
        logger,
      })
    : undefined;

  const daily = createDailyUpdateService({
    store,
    jobLock: createJobLock(store.db),
    lockTimeoutSeconds: env.STOCK_DAILY_LOCK_TIMEOUT_SECONDS,
    csvImportService,
    syncService,
    logger,
  });

  try {
    const result = await daily.run({
      csvDirectory: args.csvDirectory ?? env.STOCK_CSV_DIRECTORY,
      tickers: resolveTickers(args.tickers, env),
    });
    logger.info("daily_job_result", {
      status: result.status,
      exitCode: result.exitCode,
      csvFiles: result.csv.files,
      rowsInserted: result.csv.rowsInserted,
      syncSucceeded: result.sync.succeeded,
      syncFailed: result.sync.failed,
    });
    return result.exitCode;
  } finally {
    store.close();
  }
}

main().then(
  (code) => process.exit(code),
  () => process.exit(DAILY_EXIT.DB_ERROR)
);
