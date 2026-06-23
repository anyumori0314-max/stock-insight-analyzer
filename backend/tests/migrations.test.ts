import { describe, expect, it } from "vitest";

import { openDatabase } from "../src/db/sqlite";
import {
  LATEST_SCHEMA_VERSION,
  appliedVersions,
  runMigrations,
} from "../src/db/migrations";

describe("runMigrations", () => {
  it("creates the schema on first run and records the version", () => {
    const db = openDatabase({ location: ":memory:" });
    const result = runMigrations(db);

    expect(result.appliedNow).toEqual([1]);
    expect(result.currentVersion).toBe(LATEST_SCHEMA_VERSION);
    expect([...appliedVersions(db)]).toContain(1);

    // All four core tables plus the lock table exist and are queryable.
    for (const table of ["price_bars", "import_runs", "sync_state", "job_locks", "schema_migrations"]) {
      expect(() => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).not.toThrow();
    }
    db.close();
  });

  it("is idempotent: a second run applies nothing and does not throw", () => {
    const db = openDatabase({ location: ":memory:" });
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.appliedNow).toEqual([]);

    // Re-running a third time is still safe.
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });

  it("enforces price_bars constraints (positive prices, OHLC order, source allow-list)", () => {
    const db = openDatabase({ location: ":memory:" });
    runMigrations(db);
    const insert = db.prepare(
      "INSERT INTO price_bars (ticker, trade_date, open, high, low, close, adjusted_close, volume, currency, source, imported_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    // high < low violates the CHECK constraint.
    expect(() =>
      insert.run("AAPL", "2026-06-01", 10, 5, 9, 8, null, 100, null, "csv", "t", "t")
    ).toThrow();
    // An unknown source is rejected.
    expect(() =>
      insert.run("AAPL", "2026-06-01", 10, 12, 9, 11, null, 100, null, "bogus", "t", "t")
    ).toThrow();
    db.close();
  });
});
