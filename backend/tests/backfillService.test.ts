import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBackfillService } from "../src/services/backfillService";
import { createCsvImportService } from "../src/services/csvImportService";
import { openTestStore, type TestStore } from "./historicalHelpers";

const LIMITS = { maxRows: 100_000, maxBytes: 5_000_000 };
const HEADER = "ticker,date,open,high,low,close,volume";

let store: TestStore;
let tmpDir: string;

beforeEach(() => {
  store = openTestStore();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
});
afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeBackfill() {
  const csvImportService = createCsvImportService({
    db: store.db,
    priceRepository: store.prices,
    importRunRepository: store.importRuns,
    limits: LIMITS,
  });
  return createBackfillService({ csvImportService });
}

function writeCsv(name: string, body: string) {
  fs.writeFileSync(path.join(tmpDir, name), body, "utf8");
}

/** A per-ticker CSV of `count` consecutive calendar days from 2025-01-01. */
function rows(ticker: string, count: number, closeBase = 100): string {
  const lines = [HEADER];
  const cursor = new Date(Date.UTC(2025, 0, 1));
  for (let i = 0; i < count; i += 1) {
    const d = cursor.toISOString().slice(0, 10);
    const close = closeBase + (i % 5);
    lines.push(`${ticker},${d},${close},${close + 2},${close - 2},${close},${1000 + i}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return lines.join("\n");
}

describe("BackfillService", () => {
  it("imports a directory of per-ticker CSVs and aggregates the totals", () => {
    writeCsv("AAPL.csv", rows("AAPL", 300)); // a large file (300 rows)
    writeCsv("MSFT.csv", rows("MSFT", 130));
    const summary = makeBackfill().run(tmpDir);

    expect(summary.status).toBe("completed");
    expect(summary.filesProcessed).toBe(2);
    expect(summary.filesSucceeded).toBe(2);
    expect(summary.filesFailed).toBe(0);
    expect(summary.rowsInserted).toBe(430);
    expect(summary.rowsUpdated).toBe(0);
    expect(summary.rowsUnchanged).toBe(0);
    expect(store.prices.countBars("AAPL")).toBe(300);
    expect(store.prices.countBars("MSFT")).toBe(130);
  });

  it("is idempotent: a second run reports every row unchanged and writes nothing new", () => {
    writeCsv("AAPL.csv", rows("AAPL", 50));
    const backfill = makeBackfill();
    backfill.run(tmpDir);
    const second = backfill.run(tmpDir);
    expect(second.status).toBe("completed");
    expect(second.rowsInserted).toBe(0);
    expect(second.rowsUnchanged).toBe(50);
    expect(store.prices.countBars("AAPL")).toBe(50);
  });

  it("counts updates when a re-run changes a stored row's values", () => {
    writeCsv("AAPL.csv", rows("AAPL", 5, 100));
    const backfill = makeBackfill();
    backfill.run(tmpDir);
    writeCsv("AAPL.csv", rows("AAPL", 5, 200)); // different closes => updates
    const second = backfill.run(tmpDir);
    expect(second.rowsUpdated).toBe(5);
    expect(second.rowsInserted).toBe(0);
  });

  it("isolates a malformed file: it fails alone (persisting nothing) while valid files load", () => {
    writeCsv("GOOD.csv", rows("GOOD", 20));
    // BAD.csv has one impossible date => the WHOLE file is rejected, atomically.
    writeCsv("BAD.csv", `${HEADER}\nBAD,2025-01-01,10,12,9,11,1000\nBAD,2025-02-30,10,12,9,11,1000`);
    const summary = makeBackfill().run(tmpDir);

    expect(summary.status).toBe("partial");
    expect(summary.filesSucceeded).toBe(1);
    expect(summary.filesFailed).toBe(1);
    expect(store.prices.countBars("GOOD")).toBe(20);
    // The bad file's one valid row was NOT partially persisted.
    expect(store.prices.countBars("BAD")).toBe(0);
  });

  it("is resumable: after a partial run, fixing the bad file and re-running completes it", () => {
    writeCsv("GOOD.csv", rows("GOOD", 20));
    writeCsv("BAD.csv", `${HEADER}\nBAD,2025-01-01,10,12,9,11,1000\nBAD,2025-02-30,10,12,9,11,1000`);
    const backfill = makeBackfill();
    expect(backfill.run(tmpDir).status).toBe("partial");

    // Fix the previously-bad file and re-run; GOOD is unchanged, BAD now loads.
    writeCsv("BAD.csv", rows("BAD", 10));
    const second = backfill.run(tmpDir);
    expect(second.status).toBe("completed");
    expect(second.rowsUnchanged).toBe(20); // GOOD untouched on the resume
    expect(second.rowsInserted).toBe(10); // BAD now persisted
    expect(store.prices.countBars("BAD")).toBe(10);
  });

  it("reports an empty directory as 'empty' (no files, exit-ok semantics)", () => {
    const summary = makeBackfill().run(tmpDir);
    expect(summary.status).toBe("empty");
    expect(summary.filesProcessed).toBe(0);
  });

  it("flags a directory that does not exist as a failure", () => {
    const summary = makeBackfill().run(path.join(tmpDir, "does-not-exist"));
    expect(summary.filesFailed).toBe(1);
    expect(summary.status).toBe("failed");
  });
});
