import fs from "fs";
import os from "os";
import path from "path";

import { appliedVersions, LATEST_SCHEMA_VERSION } from "../db/migrations";
import { openHistoricalStore } from "../db/store";
import { createBackfillService } from "../services/backfillService";
import { createCsvImportService } from "../services/csvImportService";
import { createDataCoverageService } from "../services/dataCoverageService";
import { createLogger } from "../utils/logger";

/**
 * `npm run ci:smoke` — a self-contained, OFFLINE smoke test for CI.
 *
 * It exercises the data pipeline end to end against a THROWAWAY temp database and
 * a generated temp CSV (NEVER a real database, real CSV, API key, or network):
 *   1. open a fresh SQLite store and confirm migrations reach the latest version;
 *   2. backfill a generated CSV directory and confirm the rows were inserted;
 *   3. re-run the backfill and confirm it is idempotent (all rows unchanged);
 *   4. read coverage back.
 *
 * Because it runs identically on Linux and Windows runners, it also proves the
 * cross-platform SQLite path handling and CLI plumbing. Exit 0 = pass, 1 = fail.
 * Everything is created under the OS temp dir and removed in `finally`.
 */

function fail(logger: ReturnType<typeof createLogger>, reason: string): never {
  logger.error("ci_smoke_failed", { reason });
  process.exit(1);
}

function main(): void {
  const logger = createLogger({ level: "info" });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-smoke-"));
  const dbPath = path.join(workDir, "ci-smoke.sqlite");
  const csvDir = path.join(workDir, "history");
  fs.mkdirSync(csvDir, { recursive: true });

  try {
    // 1. Generate a synthetic per-ticker CSV (clearly NOT real market data).
    const header = "ticker,date,open,high,low,close,volume";
    const lines = [header];
    const cursor = new Date(Date.UTC(2025, 0, 1));
    for (let i = 0; i < 40; i += 1) {
      const d = cursor.toISOString().slice(0, 10);
      const close = 100 + (i % 7);
      lines.push(`CIA,${d},${close},${close + 2},${close - 2},${close},${1000 + i}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    fs.writeFileSync(path.join(csvDir, "CIA.csv"), lines.join("\n"), "utf8");

    // 2. Open the store (runs migrations) and assert the schema is current.
    const store = openHistoricalStore({ location: dbPath });
    try {
      const applied = appliedVersions(store.db);
      if (!applied.has(LATEST_SCHEMA_VERSION)) {
        fail(logger, "migrations_not_at_latest");
      }
      logger.info("ci_smoke_migrations_ok", { currentVersion: LATEST_SCHEMA_VERSION });

      const csvImportService = createCsvImportService({
        db: store.db,
        priceRepository: store.prices,
        importRunRepository: store.importRuns,
        limits: { maxRows: 100_000, maxBytes: 5_000_000 },
        logger,
      });
      const backfill = createBackfillService({ csvImportService, logger });

      // 3. First backfill: rows inserted.
      const first = backfill.run(csvDir);
      if (first.status !== "completed" || first.rowsInserted !== 40) {
        fail(logger, `backfill_unexpected:${first.status}:${first.rowsInserted}`);
      }

      // 4. Second backfill: idempotent (all unchanged, nothing inserted).
      const second = backfill.run(csvDir);
      if (second.rowsInserted !== 0 || second.rowsUnchanged !== 40) {
        fail(logger, `idempotency_broken:${second.rowsInserted}:${second.rowsUnchanged}`);
      }

      const coverage = createDataCoverageService({
        priceRepository: store.prices,
        importRunRepository: store.importRuns,
        syncStateRepository: store.syncState,
      }).getCoverage("CIA");
      if (coverage.recordCount !== 40) {
        fail(logger, `coverage_unexpected:${coverage.recordCount}`);
      }
      logger.info("ci_smoke_ok", {
        recordCount: coverage.recordCount,
        availableRanges: coverage.availableRanges.join(","),
      });
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
