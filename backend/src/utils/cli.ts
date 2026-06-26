/**
 * Tiny safety wrapper for the synchronous data CLIs.
 *
 * Runs a CLI `main()` and converts an UNEXPECTED throw into a SAFE, path-free
 * exit. A thrown error's `.message` / stack can embed absolute paths (e.g. an fs
 * `EACCES` on `STOCK_DB_PATH`) or other host detail, so the raw error is NEVER
 * printed — only a generic line and a non-zero exit code. Expected, handled
 * errors are still reported by each CLI's own safe (base-name-only) logging
 * before they reach here.
 */
export function runCli(main: () => number): never {
  try {
    process.exit(main());
  } catch {
    process.stderr.write(
      "Unexpected error. No paths or secrets are printed; " +
        "check your configuration (e.g. STOCK_DB_PATH / STOCK_BACKUP_DIR) and try again.\n"
    );
    process.exit(1);
  }
}
