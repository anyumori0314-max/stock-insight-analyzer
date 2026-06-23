import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCsvImportService } from "../src/services/csvImportService";
import {
  DAILY_EXIT,
  DAILY_LOCK_NAME,
  createDailyUpdateService,
} from "../src/services/dailyUpdateService";
import { createJobLock } from "../src/services/jobLock";
import { createMarketDataSyncService } from "../src/services/marketDataSyncService";
import type { AlphaVantageClient } from "../src/services/alphaVantageClient";
import { createLogger, type LogLevel } from "../src/utils/logger";
import type { DailyBar, StockTimeSeries } from "../src/types/stock";
import { openTestStore, type TestStore } from "./historicalHelpers";

const NOW = () => new Date("2026-06-23T12:00:00.000Z");
const HEADER = "ticker,date,open,high,low,close,volume";

let store: TestStore;
let tmpDir: string;
beforeEach(() => {
  store = openTestStore();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-"));
});
afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function bar(date: string): DailyBar {
  return { date, open: 10, high: 12, low: 9, close: 11, adjustedClose: null, volume: 1000 };
}
function series(ticker: string, bars: DailyBar[]): StockTimeSeries {
  return {
    ticker,
    range: "3m",
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: bars[bars.length - 1]?.date ?? null,
    priceBasis: "close",
    bars,
    warnings: [],
  };
}
function csvImport() {
  return createCsvImportService({
    db: store.db,
    priceRepository: store.prices,
    importRunRepository: store.importRuns,
    limits: { maxRows: 1000, maxBytes: 1_000_000 },
  });
}
function makeDaily(opts: {
  csvImportService?: ReturnType<typeof csvImport>;
  provider?: AlphaVantageClient;
  logSink?: (level: LogLevel, line: string) => void;
}) {
  const syncService = opts.provider
    ? createMarketDataSyncService({
        provider: opts.provider,
        db: store.db,
        priceRepository: store.prices,
        syncStateRepository: store.syncState,
        staleAfterHours: 24,
        now: NOW,
      })
    : undefined;
  return createDailyUpdateService({
    store,
    jobLock: createJobLock(store.db, { now: NOW }),
    lockTimeoutSeconds: 3600,
    csvImportService: opts.csvImportService,
    syncService,
    logger: opts.logSink ? createLogger({ level: "info", sink: opts.logSink, now: NOW }) : undefined,
    now: NOW,
  });
}

describe("DailyUpdateService", () => {
  it("runs a CSV-only job and releases the lock", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.csv"), `${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000`, "utf8");
    const daily = makeDaily({ csvImportService: csvImport() });
    const result = await daily.run({ csvDirectory: tmpDir, tickers: [] });
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(DAILY_EXIT.OK);
    expect(result.csv).toMatchObject({ files: 1, rowsInserted: 1 });
    expect(store.prices.countBars("AAPL")).toBe(1);
    // Lock freed afterwards.
    expect(createJobLock(store.db, { now: NOW }).inspect(DAILY_LOCK_NAME)).toBeNull();
  });

  it("runs an API-only job (provider top-up)", async () => {
    // Seed a stored bar so the sync sees the ticker as behind.
    store.prices.upsertBar(
      { ticker: "AAPL", tradeDate: "2026-06-17", open: 10, high: 12, low: 9, close: 11, adjustedClose: null, volume: 1000, currency: null, source: "csv" },
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z"
    );
    const provider: AlphaVantageClient = { fetchDailySeries: vi.fn(async () => series("AAPL", [bar("2026-06-22")])) };
    const result = await makeDaily({ provider }).run({ tickers: ["AAPL"] });
    expect(result.sync).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(store.prices.getLatestTradeDate("AAPL")).toBe("2026-06-22");
  });

  it("runs CSV import + API top-up together", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.csv"), `${HEADER}\nAAPL,2026-06-17,10,12,9,11,1000`, "utf8");
    const provider: AlphaVantageClient = { fetchDailySeries: vi.fn(async () => series("AAPL", [bar("2026-06-22")])) };
    const result = await makeDaily({ csvImportService: csvImport(), provider }).run({
      csvDirectory: tmpDir,
      tickers: ["AAPL"],
    });
    expect(result.csv.rowsInserted).toBe(1);
    expect(result.sync.succeeded).toBe(1);
    expect(store.prices.getLatestTradeDate("AAPL")).toBe("2026-06-22");
  });

  it("rejects a concurrent run (lock already held) with exit code 3", async () => {
    // Hold the lock with an independent owner.
    const holder = createJobLock(store.db, { now: NOW });
    expect(holder.acquire(DAILY_LOCK_NAME, { ttlSeconds: 3600 })).not.toBeNull();

    const result = await makeDaily({ csvImportService: csvImport() }).run({ csvDirectory: tmpDir, tickers: [] });
    expect(result.status).toBe("rejected");
    expect(result.exitCode).toBe(DAILY_EXIT.CONCURRENT);
    // The pre-existing lock is untouched.
    expect(holder.inspect(DAILY_LOCK_NAME)).not.toBeNull();
  });

  it("is idempotent across re-runs of the same CSV", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.csv"), `${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000`, "utf8");
    const daily = makeDaily({ csvImportService: csvImport() });
    await daily.run({ csvDirectory: tmpDir, tickers: [] });
    const second = await daily.run({ csvDirectory: tmpDir, tickers: [] });
    expect(second.csv).toMatchObject({ rowsInserted: 0, rowsUnchanged: 1 });
    expect(store.prices.countBars("AAPL")).toBe(1);
  });

  it("emits safe structured logs with no secrets or local paths", async () => {
    const lines: string[] = [];
    fs.writeFileSync(path.join(tmpDir, "a.csv"), `${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000`, "utf8");
    await makeDaily({
      csvImportService: csvImport(),
      logSink: (_lvl, line) => lines.push(line),
    }).run({ csvDirectory: tmpDir, tickers: [] });
    const joined = lines.join("\n");
    expect(joined).toMatch(/daily_job_started/);
    expect(joined).toMatch(/daily_job_completed/);
    expect(joined).not.toMatch(/apiKey|authorization|password|secret/i);
    expect(joined).not.toContain(tmpDir); // never logs the absolute import path
  });
});
