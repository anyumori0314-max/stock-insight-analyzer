import { randomUUID } from "crypto";

import type { SqlDatabase, SqlStatement } from "../db/sqlite";

/**
 * A SQLite-backed mutual-exclusion lock for batch jobs (Phase 14).
 *
 * Acquisition runs inside a `BEGIN IMMEDIATE` transaction, so two concurrent
 * processes (or a server + a CLI) can never both hold the lock: SQLite serializes
 * the writers, and the loser sees the winner's still-valid row and is rejected.
 *
 * RECOVERY: each lock carries an `expires_at`. An EXPIRED lock (e.g. left behind
 * by an abnormally-terminated run) is treated as free and overwritten, so a crash
 * never leaves a permanent lock. The held lock records its owner, run id and start
 * time — all internal bookkeeping, never surfaced in an API response.
 */

export interface JobLockHandle {
  name: string;
  runId: string;
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface AcquireOptions {
  /** Seconds before the lock is considered stale and reclaimable. */
  ttlSeconds: number;
  /** Opaque owner token (defaults to `pid:<pid>`). NEVER a path or secret. */
  owner?: string;
}

export interface JobLock {
  /** Returns a handle on success, or null when another holder owns a valid lock. */
  acquire(name: string, options: AcquireOptions): JobLockHandle | null;
  /** Releases a held lock (only the matching run id can release it). */
  release(handle: JobLockHandle): void;
  /** Reads the current lock row (for diagnostics / tests). */
  inspect(name: string): JobLockHandle | null;
}

interface JobLockOptions {
  now?: () => Date;
}

function rowToHandle(row: Record<string, unknown>): JobLockHandle {
  return {
    name: String(row.name),
    runId: String(row.run_id),
    owner: String(row.owner),
    acquiredAt: String(row.acquired_at),
    expiresAt: String(row.expires_at),
  };
}

export function createJobLock(db: SqlDatabase, options: JobLockOptions = {}): JobLock {
  const now = options.now ?? (() => new Date());
  const select: SqlStatement = db.prepare("SELECT * FROM job_locks WHERE name = ?");
  const upsert: SqlStatement = db.prepare(
    "INSERT INTO job_locks (name, owner, run_id, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, run_id = excluded.run_id, " +
      "acquired_at = excluded.acquired_at, expires_at = excluded.expires_at"
  );
  const del: SqlStatement = db.prepare("DELETE FROM job_locks WHERE name = ? AND run_id = ?");

  return {
    acquire(name, opts) {
      const owner = opts.owner ?? `pid:${process.pid}`;
      const runId = randomUUID();
      const acquiredAt = now();
      const expiresAt = new Date(acquiredAt.getTime() + opts.ttlSeconds * 1000);

      // The read + conditional write are atomic under BEGIN IMMEDIATE.
      return db.transaction<JobLockHandle | null>(() => {
        const existing = select.get(name);
        if (existing) {
          const expires = Date.parse(String(existing.expires_at));
          // A still-valid lock owned by someone else blocks acquisition.
          if (Number.isFinite(expires) && expires > acquiredAt.getTime()) {
            return null;
          }
          // Otherwise the lock is expired/stale and may be reclaimed.
        }
        upsert.run(name, owner, runId, acquiredAt.toISOString(), expiresAt.toISOString());
        return { name, runId, owner, acquiredAt: acquiredAt.toISOString(), expiresAt: expiresAt.toISOString() };
      });
    },
    release(handle) {
      del.run(handle.name, handle.runId);
    },
    inspect(name) {
      const row = select.get(name);
      return row ? rowToHandle(row) : null;
    },
  };
}
