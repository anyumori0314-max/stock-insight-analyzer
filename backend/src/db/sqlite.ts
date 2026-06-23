import fs from "fs";
import path from "path";

import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Thin, dependency-injection-friendly wrapper around Node's BUILT-IN
 * `node:sqlite` (`DatabaseSync`).
 *
 * WHY node:sqlite (and not better-sqlite3):
 *  - It ships INSIDE the Node runtime, so there is NO native compilation, no
 *    node-gyp toolchain and no prebuilt-binary lottery — it just works on
 *    Windows ARM (and everywhere else Node runs).
 *  - It adds ZERO entries to `npm audit` (no new dependency at all).
 *  - The task explicitly prefers Node standard features over new dependencies.
 *
 * Trade-off: it is an EXPERIMENTAL API (emits one ExperimentalWarning) and
 * requires Node >= 22.5. We therefore LAZY-load it: `mock` mode (the default) and
 * every Phase 2–11 path never import this module, so the app still boots on older
 * Node in mock/live mode. Only the SQLite-backed modes (historical/hybrid) and the
 * CLIs touch this file, and they surface a clear, safe error on an unsupported
 * runtime instead of crashing.
 *
 * SAFETY: callers ONLY ever use `prepare(...).run/get/all(...)` with positional
 * `?` placeholders — never string interpolation — so every query is fully
 * parameterized. The wrapper never logs the database path or row values.
 */

/** Minimal statement surface we depend on (positional params only). */
export interface SqlStatement {
  run(...params: ReadonlyArray<string | number | bigint | null>): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(
    ...params: ReadonlyArray<string | number | bigint | null>
  ): Record<string, unknown> | undefined;
  all(...params: ReadonlyArray<string | number | bigint | null>): Record<string, unknown>[];
}

/** Minimal database surface, so services/repositories depend on an interface. */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /**
   * Runs `fn` inside a single `BEGIN IMMEDIATE` transaction, committing on
   * success and rolling back on ANY throw (so a partial write can never persist).
   * Not re-entrant — callers must not nest transactions.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}

type SqliteModule = { DatabaseSync: typeof DatabaseSync };

let cachedModule: SqliteModule | null = null;

/**
 * Lazily loads `node:sqlite`. Throws a SAFE, actionable error (no stack, no path)
 * when the runtime is too old / the feature is unavailable.
 */
function loadSqliteModule(): SqliteModule {
  if (cachedModule) {
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedModule = require("node:sqlite") as SqliteModule;
    return cachedModule;
  } catch {
    throw new Error(
      "SQLite-backed data modes (historical/hybrid) and the data CLIs require " +
        "Node.js >= 22.5 with the built-in node:sqlite module. The current runtime " +
        "does not provide it."
    );
  }
}

export interface OpenDatabaseOptions {
  /**
   * Filesystem path for the database file, or ":memory:" for an ephemeral
   * in-memory database (used by tests). A parent directory is created on demand
   * for a file path.
   */
  location: string;
  /** Open read-only (used by read-only probes); defaults to false. */
  readOnly?: boolean;
}

/** Wraps a live `DatabaseSync` in the {@link SqlDatabase} interface. */
function wrap(db: DatabaseSync): SqlDatabase {
  let depth = 0;
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const stmt: StatementSync = db.prepare(sql);
      return stmt as unknown as SqlStatement;
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) {
        throw new Error("Nested SQLite transactions are not supported.");
      }
      depth += 1;
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The transaction may already be aborted; nothing further to do.
        }
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close(): void {
      db.close();
    },
  };
}

/**
 * Opens (creating if needed) a SQLite database at `location`, applying the
 * standard pragmas (WAL journal, enforced foreign keys, a bounded busy timeout)
 * and returning the DI-friendly wrapper. The parent directory of a file path is
 * created recursively before opening.
 */
export function openDatabase(options: OpenDatabaseOptions): SqlDatabase {
  const { DatabaseSync } = loadSqliteModule();
  const location = options.location;

  if (location !== ":memory:") {
    const dir = path.dirname(path.resolve(location));
    // Create the directory tree up-front so opening never fails on a fresh
    // checkout. Errors here surface to the caller (CLI / startup) as-is.
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(location, { readOnly: options.readOnly ?? false });
  // WAL keeps readers and a single writer from blocking each other; foreign_keys
  // enforces referential integrity; busy_timeout bounds lock contention so a
  // concurrent CLI run fails fast (and predictably) rather than hanging.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return wrap(db);
}
