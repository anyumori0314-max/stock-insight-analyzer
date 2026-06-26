import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../src/db/sqlite";
import { openHistoricalStore } from "../src/db/store";
import { createBackupService } from "../src/services/backupService";
import { createLogger } from "../src/utils/logger";
import type { PriceBar } from "../src/domain/historical";

let workDir: string;
let dbPath: string;
let backupDir: string;

function bar(date: string, close: number): PriceBar {
  return {
    ticker: "AAA",
    tradeDate: date,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    adjustedClose: null,
    volume: 1000,
    currency: "USD",
    source: "csv",
  };
}

/** Seeds the live DB with `count` bars (creates the file + migrations). */
function seed(count: number): void {
  const store = openHistoricalStore({ location: dbPath });
  const ts = "2025-01-01T00:00:00.000Z";
  const bars: PriceBar[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = String(i + 1).padStart(2, "0");
    bars.push(bar(`2025-01-${day}`, 100 + i));
  }
  store.prices.upsertBars(bars, ts, ts);
  store.close();
}

function countBars(): number {
  const store = openHistoricalStore({ location: dbPath });
  try {
    return store.prices.countBars("AAA");
  } finally {
    store.close();
  }
}

/** A clock that advances one second per read, so snapshot names are distinct. */
function steppingClock(): () => Date {
  let t = Date.UTC(2026, 0, 1, 0, 0, 0);
  return () => {
    const d = new Date(t);
    t += 1000;
    return d;
  };
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  dbPath = path.join(workDir, "history.sqlite");
  backupDir = path.join(workDir, "backups");
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("backupService.backup", () => {
  it("creates a consistent snapshot and reports the plan", () => {
    seed(5);
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7, now: steppingClock() });
    const plan = service.backup();
    expect(plan.dryRun).toBe(false);
    expect(plan.snapshot).toMatch(/^history-\d{8}-\d{6}\.sqlite$/);
    expect(fs.existsSync(path.join(backupDir, plan.snapshot))).toBe(true);
    expect(service.listBackups()).toHaveLength(1);
  });

  it("dry-run reports the snapshot name without writing a file", () => {
    seed(3);
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7, now: steppingClock() });
    const plan = service.backup({ dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.snapshot).toMatch(/^history-/);
    expect(service.listBackups()).toHaveLength(0);
  });

  it("prunes old generations beyond keepGenerations (newest retained)", () => {
    seed(2);
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 2, now: steppingClock() });
    const first = service.backup().snapshot;
    service.backup();
    const third = service.backup();
    const remaining = service.listBackups().map((b) => b.name);
    expect(remaining).toHaveLength(2);
    expect(remaining).not.toContain(first); // oldest pruned
    expect(remaining).toContain(third.snapshot);
    expect(third.pruned).toContain(first);
  });

  it("throws when there is no database to back up", () => {
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7 });
    expect(() => service.backup()).toThrow(/no database/i);
  });
});

describe("backupService.restore", () => {
  it("restores the database content from a validated snapshot", () => {
    seed(3);
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7, now: steppingClock() });
    const snapshot = service.backup().snapshot;

    // Mutate the live DB AFTER the snapshot, then restore it back.
    seed(8); // upsert keeps the 3 + adds 5 more -> 8 bars
    expect(countBars()).toBe(8);

    const plan = service.restore({ file: snapshot });
    expect(plan.restored).toBe(true);
    expect(plan.safetySnapshot).toMatch(/^pre-restore-/);
    expect(plan.sourceSchemaVersion).toBeGreaterThan(0);
    expect(countBars()).toBe(3); // back to the snapshot's content
    // The pre-restore safety snapshot of the 8-bar DB exists.
    expect(fs.existsSync(path.join(backupDir, plan.safetySnapshot!))).toBe(true);
  });

  it("dry-run validates the source but changes nothing", () => {
    seed(3);
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7, now: steppingClock() });
    const snapshot = service.backup().snapshot;
    seed(8);
    const plan = service.restore({ file: snapshot, dryRun: true });
    expect(plan.restored).toBe(false);
    expect(plan.safetySnapshot).toBeNull;
    expect(countBars()).toBe(8); // unchanged
  });

  it("rejects a missing backup file", () => {
    seed(1);
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7 });
    expect(() => service.restore({ file: "does-not-exist.sqlite" })).toThrow(/does not exist/i);
  });

  it("rejects a file that is not a valid history database", () => {
    seed(1);
    fs.mkdirSync(backupDir, { recursive: true });
    const bogus = path.join(backupDir, "history-20260101-000000.sqlite");
    fs.writeFileSync(bogus, "this is not sqlite", "utf8");
    const service = createBackupService({ dbPath, backupDir, keepGenerations: 7 });
    expect(() => service.restore({ file: "history-20260101-000000.sqlite" })).toThrow();
  });
});

describe("backupService.restore — path safety & atomicity", () => {
  function service(opts?: { dbPath?: string }) {
    return createBackupService({
      dbPath: opts?.dbPath ?? dbPath,
      backupDir,
      keepGenerations: 7,
      now: steppingClock(),
    });
  }

  it("rejects a source outside the backup directory (absolute path)", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    const outside = path.join(workDir, "outside.sqlite");
    fs.copyFileSync(path.join(backupDir, snapshot), outside);
    expect(() => svc.restore({ file: outside })).toThrow(/backup directory/i);
    expect(countBars()).toBe(3); // untouched
  });

  it("rejects a `..` path-traversal escape from the backup directory", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    fs.copyFileSync(path.join(backupDir, snapshot), path.join(workDir, "outside.sqlite"));
    expect(() => svc.restore({ file: "../outside.sqlite" })).toThrow(/backup directory/i);
  });

  it("rejects a symbolic-link source", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    const linkPath = path.join(backupDir, "history-29990101-000000.sqlite");
    let linkCreated = true;
    try {
      fs.symlinkSync(path.join(backupDir, snapshot), linkPath);
    } catch {
      linkCreated = false; // symlinks need privilege on Windows; skip if unavailable
    }
    if (!linkCreated) return;
    expect(() => svc.restore({ file: "history-29990101-000000.sqlite" })).toThrow(/symbolic link/i);
  });

  it("rejects restoring directly from the live database file (same file)", () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const inDirDb = path.join(backupDir, "history-20260101-000000.sqlite");
    const ts = "2025-01-01T00:00:00.000Z";
    const store = openHistoricalStore({ location: inDirDb });
    store.prices.upsertBars([bar("2025-01-01", 100)], ts, ts);
    store.close();
    const svc = createBackupService({ dbPath: inDirDb, backupDir, keepGenerations: 7 });
    expect(() => svc.restore({ file: "history-20260101-000000.sqlite" })).toThrow(/live database/i);
  });

  it("rejects a backup created by a newer schema version", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    const db = openDatabase({ location: path.join(backupDir, snapshot) });
    try {
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        999,
        "future",
        "2999-01-01T00:00:00.000Z"
      );
    } finally {
      db.close();
    }
    expect(() => svc.restore({ file: snapshot })).toThrow(/newer schema/i);
    expect(countBars()).toBe(3);
  });

  it("leaves NO -wal / -shm / -journal sidecars after a successful restore", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    seed(8);
    svc.restore({ file: snapshot });
    // Check BEFORE any read (a read would re-create -wal/-shm via WAL mode).
    expect(fs.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-shm`)).toBe(false);
    expect(fs.existsSync(`${dbPath}-journal`)).toBe(false);
    expect(countBars()).toBe(3);
  });

  it("preserves the current DB (rolls back) when staging the restore copy fails", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    seed(8); // live now holds 8 bars
    const realCopy = fs.copyFileSync.bind(fs);
    const spy = vi.spyOn(fs, "copyFileSync").mockImplementation(((src: fs.PathLike, dest: fs.PathLike, mode?: number) => {
      if (String(dest).includes(".restore-")) throw new Error("ENOSPC: out of space");
      return realCopy(src, dest, mode);
    }) as typeof fs.copyFileSync);
    expect(() => svc.restore({ file: snapshot })).toThrow();
    spy.mockRestore();
    expect(countBars()).toBe(8); // rolled back from the pre-restore snapshot, not corrupted
    expect(fs.readdirSync(workDir).filter((f) => f.includes(".restore-"))).toHaveLength(0);
  });

  it("rolls back from the pre-restore snapshot when the atomic rename fails", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    seed(8);
    const spy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("EPERM: file is locked");
    });
    expect(() => svc.restore({ file: snapshot })).toThrow();
    spy.mockRestore();
    expect(countBars()).toBe(8); // intact; the swap never landed
    expect(fs.readdirSync(workDir).filter((f) => f.includes(".restore-"))).toHaveLength(0);
  });

  it("records the original error AND the rollback failure safely (no absolute paths)", () => {
    seed(3);
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", sink: (_lvl, line) => lines.push(line) });
    const svc = createBackupService({
      dbPath,
      backupDir,
      keepGenerations: 7,
      now: steppingClock(),
      logger,
    });
    const snapshot = svc.backup().snapshot;
    seed(8);
    // Make every copy (temp stage AND rollback) fail, forcing a rollback failure.
    const spy = vi.spyOn(fs, "copyFileSync").mockImplementation((() => {
      throw new Error("disk error");
    }) as typeof fs.copyFileSync);
    expect(() => svc.restore({ file: snapshot })).toThrow();
    spy.mockRestore();
    const rollbackFailed = lines.map((l) => JSON.parse(l)).find((r) => r.event === "restore_rollback_failed");
    expect(rollbackFailed).toBeDefined();
    expect(typeof rollbackFailed.reason).toBe("string");
    expect(typeof rollbackFailed.rollbackError).toBe("string");
    // Safe fields only: no absolute path (the temp dir) leaks into the log.
    expect(JSON.stringify(rollbackFailed)).not.toContain(workDir);
  });

  it("dry-run validates the source but writes nothing", () => {
    seed(3);
    const svc = service();
    const snapshot = svc.backup().snapshot;
    seed(8);
    const before = fs.readdirSync(backupDir).length;
    const plan = svc.restore({ file: snapshot, dryRun: true });
    expect(plan.restored).toBe(false);
    expect(countBars()).toBe(8); // unchanged
    expect(fs.readdirSync(backupDir).length).toBe(before); // no pre-restore snapshot written
  });
});
