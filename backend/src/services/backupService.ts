import fs from "fs";
import path from "path";

import { appliedVersions, LATEST_SCHEMA_VERSION } from "../db/migrations";
import { openDatabase } from "../db/sqlite";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";

/**
 * SQLite backup / restore for the historical store (Phase 21).
 *
 * DESIGN:
 *  - Backup uses `VACUUM INTO` — an ONLINE, transactionally-consistent snapshot
 *    that produces a single defragmented file (folding in the WAL), so it is safe
 *    even if the app is running. No file copy of a live WAL database is ever made.
 *  - Generation management keeps the newest N timestamped snapshots and prunes
 *    the rest. Backup names sort chronologically (`history-YYYYMMDD-HHMMSS`).
 *  - Restore is ATOMIC and ROLLBACK-SAFE with strict path constraints:
 *      1. the source is confined to the backup directory (realpath, no symlinks,
 *         no `..` traversal), must be a regular file, must not BE the live DB, and
 *         must pass integrity_check with a real, not-newer-than-current schema;
 *      2. the current DB is snapshotted FIRST (a reversible pre-restore copy);
 *      3. the validated source is copied to a temp file ON THE SAME FILESYSTEM as
 *         the DB, integrity-checked, then swapped in with an ATOMIC rename and the
 *         stale `-wal` / `-shm` / `-journal` sidecars removed;
 *      4. the swapped-in DB is re-opened and re-verified.
 *    If ANY step fails the temp file is removed and the DB is ROLLED BACK from the
 *    pre-restore snapshot, so a half-written / corrupt database is never left behind.
 *  - Every operation supports `dryRun`, which computes and returns the exact plan
 *    (what WOULD be created / pruned / restored) without touching the filesystem.
 *
 * SAFETY: only SAFE fields are logged (base file names, counts, booleans, ISO
 * instants) — never an absolute path, stack, row value or secret.
 */

const BACKUP_SUFFIX = ".sqlite";
/** A normal generational snapshot: `history-YYYYMMDD-HHMMSS.sqlite`. */
const BACKUP_RE = /^history-\d{8}-\d{6}\.sqlite$/;
/** A pre-restore safety snapshot: `pre-restore-YYYYMMDD-HHMMSS.sqlite`. */
const SAFETY_PREFIX = "pre-restore-";

export interface BackupServiceOptions {
  /** Path to the live SQLite database (the STOCK_DB_PATH). */
  dbPath: string;
  /** Directory where snapshots are written / read. Created on demand. */
  backupDir: string;
  /** How many generational snapshots to retain (newest wins). >= 1. */
  keepGenerations: number;
  now?: () => Date;
  logger?: Logger;
}

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface BackupPlan {
  dryRun: boolean;
  /** The snapshot file name that was (or would be) created. */
  snapshot: string;
  /** Snapshot names that were (or would be) pruned to honor keepGenerations. */
  pruned: string[];
  /** Snapshots remaining after the operation. */
  remaining: number;
}

export interface RestorePlan {
  dryRun: boolean;
  /** Base name of the source snapshot. */
  source: string;
  /** The pre-restore safety snapshot taken of the current DB (null if none). */
  safetySnapshot: string | null;
  /** The schema version detected in the source snapshot. */
  sourceSchemaVersion: number;
  restored: boolean;
}

export interface BackupService {
  listBackups(): BackupInfo[];
  backup(options?: { dryRun?: boolean }): BackupPlan;
  restore(options: { file: string; dryRun?: boolean }): RestorePlan;
}

/** Escapes a path for safe embedding in a single-quoted SQL string literal. */
function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Canonical path: realpath when the entry exists, else a plain resolve. */
function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `child` is the same as, or nested under, `parent` (both canonical). */
function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Case-insensitive on Windows, where the filesystem is not case-sensitive. */
function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Runs `PRAGMA integrity_check` on a closed DB file; returns true only for "ok". */
function integrityOk(filePath: string): boolean {
  const db = openDatabase({ location: filePath, readOnly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    return Boolean(row) && String(Object.values(row!)[0]) === "ok";
  } finally {
    db.close();
  }
}

export function createBackupService(options: BackupServiceOptions): BackupService {
  const { dbPath, backupDir } = options;
  const keep = Math.max(1, Math.floor(options.keepGenerations));
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? silentLogger;

  function timestamp(): string {
    const d = now();
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
    );
  }

  function listBackups(): BackupInfo[] {
    if (!fs.existsSync(backupDir)) {
      return [];
    }
    return fs
      .readdirSync(backupDir)
      .filter((name) => BACKUP_RE.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(backupDir, name));
        return { name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      })
      // Newest first (the timestamped name sorts chronologically).
      .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  }

  /** Writes a consistent single-file snapshot of `dbPath` to `targetPath`. */
  function vacuumInto(targetPath: string): void {
    const db = openDatabase({ location: dbPath });
    try {
      db.exec(`VACUUM INTO '${sqlString(targetPath)}'`);
    } finally {
      db.close();
    }
  }

  function backup(opts: { dryRun?: boolean } = {}): BackupPlan {
    const dryRun = opts.dryRun ?? false;
    if (!fs.existsSync(dbPath)) {
      throw new Error("No database file exists to back up.");
    }
    const snapshot = `history-${timestamp()}${BACKUP_SUFFIX}`;

    // Determine what to prune. In a dry run the snapshot is not actually written,
    // so include it in the projected set to report an accurate plan.
    const existing = listBackups().map((b) => b.name);
    const projected = [snapshot, ...existing].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const pruned = projected.slice(keep);

    if (!dryRun) {
      fs.mkdirSync(backupDir, { recursive: true });
      vacuumInto(path.join(backupDir, snapshot));
      for (const name of pruned) {
        // Never prune the snapshot we just created.
        if (name === snapshot) continue;
        fs.rmSync(path.join(backupDir, name), { force: true });
      }
      logger.info("backup_completed", {
        snapshot,
        pruned: pruned.length,
        remaining: Math.min(projected.length, keep),
      });
    } else {
      logger.info("backup_dry_run", { snapshot, wouldPrune: pruned.length });
    }

    return {
      dryRun,
      snapshot,
      pruned: pruned.filter((n) => n !== snapshot),
      remaining: Math.min(projected.length, keep),
    };
  }

  /**
   * Confines `file` to the backup directory and rejects anything unsafe to restore
   * FROM: a non-existent path, a symlink, a path that escapes the backup dir via
   * `..`, a non-regular file, or the live DB itself. Returns the validated source.
   */
  function resolveSource(file: string): string {
    const requested = path.isAbsolute(file) ? file : path.join(backupDir, file);
    if (!fs.existsSync(requested)) {
      throw new Error("The specified backup file does not exist.");
    }
    // Reject a symlink BEFORE resolving it, so a link planted inside the backup dir
    // cannot point the restore at an arbitrary file.
    if (fs.lstatSync(requested).isSymbolicLink()) {
      throw new Error("The backup source must not be a symbolic link.");
    }
    const sourceReal = canonical(requested);
    const backupReal = canonical(backupDir);
    if (!isInsideDir(backupReal, sourceReal)) {
      throw new Error("The backup source must be inside the configured backup directory.");
    }
    if (!fs.statSync(sourceReal).isFile()) {
      throw new Error("The backup source must be a regular file.");
    }
    if (fs.existsSync(dbPath) && samePath(sourceReal, canonical(dbPath))) {
      throw new Error("The backup source must not be the live database file.");
    }
    return sourceReal;
  }

  /** Validates a snapshot is a real, intact history DB; returns its schema version. */
  function validateSource(sourcePath: string): number {
    const db = openDatabase({ location: sourcePath, readOnly: true });
    let versions: Set<number>;
    try {
      const row = db.prepare("PRAGMA integrity_check").get();
      const verdict = row ? String(Object.values(row)[0]) : "";
      if (verdict !== "ok") {
        throw new Error("The backup file failed an integrity check.");
      }
      try {
        versions = appliedVersions(db);
      } catch {
        throw new Error("The backup file is not a recognized history database.");
      }
    } finally {
      db.close();
    }
    if (versions.size === 0) {
      throw new Error("The backup file has no applied schema migrations.");
    }
    const version = Math.max(...versions);
    // Never DOWNGRADE the running build by restoring a snapshot from a newer schema.
    if (version > LATEST_SCHEMA_VERSION) {
      throw new Error("The backup file was created by a newer schema version.");
    }
    return version;
  }

  /** Best-effort removal of a DB's WAL/SHM/journal sidecars (a fresh restore is clean). */
  function clearSidecars(file: string): void {
    for (const sidecar of [`${file}-wal`, `${file}-shm`, `${file}-journal`]) {
      fs.rmSync(sidecar, { force: true });
    }
  }

  function restore(opts: { file: string; dryRun?: boolean }): RestorePlan {
    const dryRun = opts.dryRun ?? false;
    const sourcePath = resolveSource(opts.file);
    const sourceSchemaVersion = validateSource(sourcePath);

    const safetySnapshot = fs.existsSync(dbPath)
      ? `${SAFETY_PREFIX}${timestamp()}${BACKUP_SUFFIX}`
      : null;

    if (dryRun) {
      logger.info("restore_dry_run", {
        source: path.basename(sourcePath),
        wouldSafetySnapshot: Boolean(safetySnapshot),
        sourceSchemaVersion,
      });
      return { dryRun, source: path.basename(sourcePath), safetySnapshot, sourceSchemaVersion, restored: false };
    }

    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

    // 1. Snapshot the current DB first, so a bad restore is fully reversible.
    const safetyPath = safetySnapshot ? path.join(backupDir, safetySnapshot) : null;
    if (safetyPath) {
      vacuumInto(safetyPath);
    }

    // 2. Stage the validated source as a temp file ON THE SAME FILESYSTEM as the DB
    //    (so the final swap is an atomic rename, not a cross-device copy), then
    //    integrity-check the staged copy BEFORE it is allowed to replace the DB.
    const tempPath = `${dbPath}.restore-${timestamp()}-${process.pid}.tmp`;
    try {
      fs.copyFileSync(sourcePath, tempPath);
      if (!integrityOk(tempPath)) {
        throw new Error("The staged restore copy failed an integrity check.");
      }
      // 3. Atomic swap + clean sidecars (the old DB's WAL/SHM would be inconsistent
      //    with the new file). `rename` is atomic on the same filesystem.
      fs.renameSync(tempPath, dbPath);
      clearSidecars(dbPath);
      // 4. Re-open the swapped-in DB and re-verify it before declaring success.
      if (!integrityOk(dbPath)) {
        throw new Error("The restored database failed a post-swap integrity check.");
      }
    } catch (err) {
      // Roll back: drop the temp file and put the pre-restore snapshot back so the
      // live DB is never left in a corrupt / half-written state.
      fs.rmSync(tempPath, { force: true });
      let rolledBack = false;
      let rollbackError: string | null = null;
      if (safetyPath && fs.existsSync(safetyPath)) {
        try {
          fs.copyFileSync(safetyPath, dbPath);
          clearSidecars(dbPath);
          rolledBack = true;
        } catch (rbErr) {
          rollbackError = rbErr instanceof Error ? rbErr.message : "unknown";
        }
      }
      if (rollbackError) {
        logger.error("restore_rollback_failed", {
          reason: err instanceof Error ? err.message : "unknown",
          rollbackError,
          safetySnapshot,
        });
      } else {
        logger.error("restore_rolled_back", {
          reason: err instanceof Error ? err.message : "unknown",
          rolledBack,
          safetySnapshot,
        });
      }
      throw err instanceof Error ? err : new Error("The restore failed.");
    }

    logger.info("restore_completed", {
      source: path.basename(sourcePath),
      safetySnapshot,
      sourceSchemaVersion,
    });
    return { dryRun, source: path.basename(sourcePath), safetySnapshot, sourceSchemaVersion, restored: true };
  }

  return { listBackups, backup, restore };
}
