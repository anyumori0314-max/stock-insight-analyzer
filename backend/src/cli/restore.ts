import path from "path";
import dotenv from "dotenv";

import { loadEnv } from "../config/env";
import { createBackupService } from "../services/backupService";
import { runCli } from "../utils/cli";
import { createLogger } from "../utils/logger";

/**
 * `npm run data:restore` — restore the history store from a backup snapshot.
 *
 *   npm run data:restore -- --file history-20260101-000000.sqlite
 *   npm run data:restore -- --file ./backups/history-...sqlite --dry-run
 *   npm run data:restore -- --list
 *
 * The source is VALIDATED (integrity_check + a real schema) before anything is
 * changed; the current database is snapshotted FIRST (a reversible safety copy),
 * then the validated snapshot is swapped in and stale WAL/SHM sidecars removed.
 * `--dry-run` reports the plan without modifying anything.
 *
 * Exit codes: 0 ok · 1 input/other error.
 * NEVER logs absolute paths, row values, secrets or stacks.
 */

const EXIT_OK = 0;
const EXIT_ERROR = 1;

interface CliArgs {
  file?: string;
  dryRun: boolean;
  list: boolean;
  backupDir?: string;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const args: CliArgs = { dryRun: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--file") {
      args.file = argv[++i];
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
    } else if (arg === "--backup-dir") {
      args.backupDir = argv[++i];
    } else if (arg.startsWith("--backup-dir=")) {
      args.backupDir = arg.slice("--backup-dir=".length);
    } else {
      return null;
    }
  }
  if (!args.list && !args.file) {
    return null;
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    "Usage:\n" +
      "  npm run data:restore -- --file \"<NAME|PATH>\" [--dry-run]\n" +
      "  npm run data:restore -- --list\n"
  );
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    printUsage();
    return EXIT_ERROR;
  }

  dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });
  const env = loadEnv();
  const logger = createLogger({ level: "info" });

  const service = createBackupService({
    dbPath: env.STOCK_DB_PATH,
    backupDir: args.backupDir ?? env.STOCK_BACKUP_DIR,
    keepGenerations: env.STOCK_BACKUP_KEEP,
    logger,
  });

  try {
    if (args.list) {
      const backups = service.listBackups();
      for (const b of backups) {
        logger.info("backup_entry", { name: b.name, sizeBytes: b.sizeBytes, modifiedAt: b.modifiedAt });
      }
      logger.info("backup_list", { count: backups.length });
      return EXIT_OK;
    }

    const plan = service.restore({ file: args.file!, dryRun: args.dryRun });
    logger.info("restore_result", {
      dryRun: plan.dryRun,
      source: plan.source,
      safetySnapshot: plan.safetySnapshot,
      sourceSchemaVersion: plan.sourceSchemaVersion,
      restored: plan.restored,
    });
    return EXIT_OK;
  } catch (err) {
    logger.error("restore_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return EXIT_ERROR;
  }
}

runCli(main);
