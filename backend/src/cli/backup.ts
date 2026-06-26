import path from "path";
import dotenv from "dotenv";

import { loadEnv } from "../config/env";
import { createBackupService } from "../services/backupService";
import { runCli } from "../utils/cli";
import { createLogger } from "../utils/logger";

/**
 * `npm run data:backup` — take a consistent SQLite snapshot of the history store
 * and prune old generations.
 *
 *   npm run data:backup
 *   npm run data:backup -- --dry-run
 *   npm run data:backup -- --backup-dir "./backups" --keep 14
 *
 * Uses `VACUUM INTO` (online, transactionally consistent) so it is safe even
 * while the app is running. `--dry-run` reports the exact plan (snapshot name +
 * what would be pruned) without writing anything.
 *
 * Exit codes: 0 ok · 1 input/other error.
 * NEVER logs absolute paths, row values, secrets or stacks.
 */

const EXIT_OK = 0;
const EXIT_ERROR = 1;

interface CliArgs {
  dryRun: boolean;
  backupDir?: string;
  keep?: number;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--backup-dir") {
      args.backupDir = argv[++i];
    } else if (arg.startsWith("--backup-dir=")) {
      args.backupDir = arg.slice("--backup-dir=".length);
    } else if (arg === "--keep") {
      args.keep = Number(argv[++i]);
    } else if (arg.startsWith("--keep=")) {
      args.keep = Number(arg.slice("--keep=".length));
    } else {
      return null;
    }
  }
  if (args.keep !== undefined && (!Number.isInteger(args.keep) || args.keep < 1)) {
    return null;
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    "Usage:\n" +
      "  npm run data:backup [-- --dry-run] [--backup-dir \"<DIR>\"] [--keep <N>]\n"
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
    keepGenerations: args.keep ?? env.STOCK_BACKUP_KEEP,
    logger,
  });

  try {
    const plan = service.backup({ dryRun: args.dryRun });
    logger.info("backup_result", {
      dryRun: plan.dryRun,
      snapshot: plan.snapshot,
      pruned: plan.pruned.length,
      remaining: plan.remaining,
    });
    return EXIT_OK;
  } catch (err) {
    // Safe message only — never a stack or absolute path.
    logger.error("backup_failed", { reason: err instanceof Error ? err.message : "unknown" });
    return EXIT_ERROR;
  }
}

runCli(main);
