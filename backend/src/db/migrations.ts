import type { SqlDatabase } from "./sqlite";

/**
 * Forward-only SQLite migrations for the historical-data pipeline.
 *
 * Each migration is an idempotent SQL script guarded by a version row in
 * `schema_migrations`. `runMigrations` applies every not-yet-applied migration in
 * order inside a single transaction, so a half-applied schema can never persist.
 * Re-running after every migration is applied is a no-op — the runner is safe to
 * call on every startup and from every CLI.
 *
 * The DDL itself uses `IF NOT EXISTS`, so even a manually re-created database
 * heals rather than erroring. Schema changes go at the END of the list with the
 * next version number; existing migrations are never edited.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS price_bars (
        ticker         TEXT    NOT NULL,
        trade_date     TEXT    NOT NULL,
        open           REAL    NOT NULL,
        high           REAL    NOT NULL,
        low            REAL    NOT NULL,
        close          REAL    NOT NULL,
        adjusted_close REAL,
        volume         INTEGER NOT NULL,
        currency       TEXT,
        source         TEXT    NOT NULL,
        imported_at    TEXT    NOT NULL,
        updated_at     TEXT    NOT NULL,
        PRIMARY KEY (ticker, trade_date),
        CHECK (length(trade_date) = 10),
        CHECK (open  > 0),
        CHECK (high  > 0),
        CHECK (low   > 0),
        CHECK (close > 0),
        CHECK (high >= low),
        CHECK (volume >= 0),
        CHECK (adjusted_close IS NULL OR adjusted_close > 0),
        CHECK (source IN ('csv', 'api', 'mock'))
      );

      CREATE INDEX IF NOT EXISTS idx_price_bars_trade_date
        ON price_bars (trade_date);

      CREATE TABLE IF NOT EXISTS import_runs (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type        TEXT    NOT NULL,
        source_name        TEXT,
        started_at         TEXT    NOT NULL,
        finished_at        TEXT,
        status             TEXT    NOT NULL,
        rows_read          INTEGER NOT NULL DEFAULT 0,
        rows_inserted      INTEGER NOT NULL DEFAULT 0,
        rows_updated       INTEGER NOT NULL DEFAULT 0,
        rows_unchanged     INTEGER NOT NULL DEFAULT 0,
        rows_failed        INTEGER NOT NULL DEFAULT 0,
        safe_error_summary TEXT,
        CHECK (source_type IN ('csv', 'api', 'daily')),
        CHECK (status IN ('started', 'completed', 'failed'))
      );

      CREATE INDEX IF NOT EXISTS idx_import_runs_started_at
        ON import_runs (started_at);

      CREATE TABLE IF NOT EXISTS sync_state (
        ticker             TEXT PRIMARY KEY,
        latest_trade_date  TEXT,
        last_attempt_at    TEXT,
        last_success_at    TEXT,
        last_result        TEXT,
        last_error_code    TEXT,
        safe_error_message TEXT,
        CHECK (last_result IS NULL OR last_result IN ('success', 'skipped', 'failed', 'no_data'))
      );

      CREATE TABLE IF NOT EXISTS job_locks (
        name        TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        run_id      TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );
    `,
  },
] as const;

/** The highest migration version known to this build. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

function ensureMigrationsTable(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL
    );
  `);
}

/** Returns the set of already-applied migration versions. */
export function appliedVersions(db: SqlDatabase): Set<number> {
  ensureMigrationsTable(db);
  const rows = db.prepare("SELECT version FROM schema_migrations").all();
  return new Set(rows.map((row) => Number(row.version)));
}

export interface MigrationResult {
  appliedNow: number[];
  currentVersion: number;
}

/**
 * Applies every pending migration in version order. Each migration's DDL plus
 * its `schema_migrations` bookkeeping row run together in one transaction, so the
 * database is always at a consistent, fully-applied version. Idempotent: calling
 * it again once everything is applied returns `appliedNow: []`.
 */
export function runMigrations(db: SqlDatabase, now: () => Date = () => new Date()): MigrationResult {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const pending = [...MIGRATIONS]
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  const appliedNow: number[] = [];
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, now().toISOString());
    });
    appliedNow.push(migration.version);
  }

  return { appliedNow, currentVersion: LATEST_SCHEMA_VERSION };
}
