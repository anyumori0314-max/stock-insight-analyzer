import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCsvImportService } from "../src/services/csvImportService";
import type { SqlDatabase } from "../src/db/sqlite";
import { openTestStore, type TestStore } from "./historicalHelpers";

const LIMITS = { maxRows: 1000, maxBytes: 1_000_000 };
const HEADER = "ticker,date,open,high,low,close,volume";
const VALID = `${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000\nAAPL,2026-06-02,11,13,10,12,2000`;

let store: TestStore;
let tmpDir: string;

beforeEach(() => {
  store = openTestStore();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "csv-import-"));
});
afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeService(db: SqlDatabase = store.db) {
  return createCsvImportService({
    db,
    priceRepository: store.prices,
    importRunRepository: store.importRuns,
    limits: LIMITS,
  });
}

describe("CsvImportService.importContent", () => {
  it("imports a valid file and records a completed run", () => {
    const result = makeService().importContent(VALID, "prices.csv");
    expect(result.status).toBe("completed");
    expect(result).toMatchObject({ rowsRead: 2, rowsInserted: 2, rowsUpdated: 0, rowsUnchanged: 0 });
    expect(store.prices.countBars("AAPL")).toBe(2);
    expect(store.importRuns.get(result.importRunId!)?.status).toBe("completed");
  });

  it("is idempotent: re-importing the same content reports all rows unchanged", () => {
    const service = makeService();
    service.importContent(VALID, "prices.csv");
    const second = service.importContent(VALID, "prices.csv");
    expect(second.status).toBe("completed");
    expect(second).toMatchObject({ rowsInserted: 0, rowsUpdated: 0, rowsUnchanged: 2 });
    expect(store.prices.countBars("AAPL")).toBe(2);
  });

  it("counts updates when a re-imported row's values change", () => {
    const service = makeService();
    service.importContent(VALID, "prices.csv");
    const changed = `${HEADER}\nAAPL,2026-06-01,10,12,9,11.5,1000\nAAPL,2026-06-02,11,13,10,12,2000`;
    const result = service.importContent(changed, "prices.csv");
    expect(result).toMatchObject({ rowsInserted: 0, rowsUpdated: 1, rowsUnchanged: 1 });
  });

  it("persists NOTHING when any row is invalid and records a failed run", () => {
    const bad = `${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000\nAAPL,2026-02-30,10,12,9,11,1000`;
    const result = makeService().importContent(bad, "bad.csv");
    expect(result.status).toBe("input_error");
    expect(result.errors.length).toBeGreaterThan(0);
    // Atomic: the one valid row was NOT written.
    expect(store.prices.countBars("AAPL")).toBe(0);
    expect(store.importRuns.get(result.importRunId!)?.status).toBe("failed");
  });

  it("rejects a file missing a required header (fatal) with no DB change", () => {
    const result = makeService().importContent("ticker,date,open\nAAPL,2026-06-01,10", "x.csv");
    expect(result.status).toBe("input_error");
    expect(result.safeErrorSummary).toMatch(/必須列/);
    expect(store.prices.countBars("AAPL")).toBe(0);
  });

  it("rolls back and reports db_error when the transaction fails (no partial write)", () => {
    const failingDb: SqlDatabase = {
      exec: (sql) => store.db.exec(sql),
      prepare: (sql) => store.db.prepare(sql),
      close: () => store.db.close(),
      transaction: () => {
        throw new Error("disk full");
      },
    };
    const result = makeService(failingDb).importContent(VALID, "prices.csv");
    expect(result.status).toBe("db_error");
    expect(store.prices.countBars("AAPL")).toBe(0);
    expect(store.importRuns.get(result.importRunId!)?.status).toBe("failed");
  });
});

describe("CsvImportService.importFile", () => {
  it("imports a real .csv file and uses its base name as the safe source name", () => {
    const file = path.join(tmpDir, "daily.csv");
    fs.writeFileSync(file, VALID, "utf8");
    const result = makeService().importFile(file);
    expect(result.status).toBe("completed");
    expect(result.sourceName).toBe("daily.csv");
    expect(store.prices.countBars("AAPL")).toBe(2);
  });

  it("rejects a missing file as an input error", () => {
    const result = makeService().importFile(path.join(tmpDir, "nope.csv"));
    expect(result.status).toBe("input_error");
    expect(result.safeErrorSummary).toMatch(/見つかりません/);
  });

  it("rejects a non-.csv extension", () => {
    const file = path.join(tmpDir, "data.txt");
    fs.writeFileSync(file, VALID, "utf8");
    const result = makeService().importFile(file);
    expect(result.status).toBe("input_error");
    expect(result.safeErrorSummary).toMatch(/\.csv/);
  });

  it("rejects a file exceeding the byte cap", () => {
    const file = path.join(tmpDir, "big.csv");
    fs.writeFileSync(file, VALID, "utf8");
    const service = createCsvImportService({
      db: store.db,
      priceRepository: store.prices,
      importRunRepository: store.importRuns,
      limits: { maxRows: 1000, maxBytes: 10 },
    });
    const result = service.importFile(file);
    expect(result.status).toBe("input_error");
    expect(result.safeErrorSummary).toMatch(/サイズ/);
  });
});
