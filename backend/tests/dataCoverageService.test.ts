import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PriceBar, PriceSource } from "../src/domain/historical";
import { createDataCoverageService } from "../src/services/dataCoverageService";
import { isTradingDay } from "../src/utils/marketCalendar";
import { openTestStore, type TestStore } from "./historicalHelpers";

// A fixed clock AFTER every seeded date, so the future-date filter never trims a
// seeded bar and the suite is deterministic regardless of the wall clock.
const NOW = () => new Date("2026-07-15T00:00:00.000Z");

let store: TestStore;
beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

function priceBar(ticker: string, tradeDate: string, source: PriceSource = "csv"): PriceBar {
  return {
    ticker,
    tradeDate,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    adjustedClose: null,
    volume: 1000,
    currency: null,
    source,
  };
}

/** Seeds `count` consecutive CALENDAR days ending at `end` (weekends INCLUDED). */
function seedConsecutive(ticker: string, end: string, count: number, source: PriceSource = "csv") {
  const t = "2026-06-01T00:00:00.000Z";
  const bars: PriceBar[] = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    bars.unshift(priceBar(ticker, cursor.toISOString().slice(0, 10), source));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  store.prices.upsertBars(bars, t, t);
}

/** Seeds `count` real TRADING days (weekends/holidays skipped) ending at `end`. */
function seedTradingDays(ticker: string, end: string, count: number, source: PriceSource = "csv") {
  const t = "2026-06-01T00:00:00.000Z";
  const bars: PriceBar[] = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  while (bars.length < count) {
    if (isTradingDay(cursor)) {
      bars.unshift(priceBar(ticker, cursor.toISOString().slice(0, 10), source));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  store.prices.upsertBars(bars, t, t);
}

function coverageFor(ticker: string) {
  return createDataCoverageService({ priceRepository: store.prices, now: NOW }).getCoverage(ticker);
}

describe("DataCoverageService", () => {
  it("reports zeroed coverage for a ticker with no stored bars", () => {
    expect(coverageFor("aapl")).toMatchObject({
      ticker: "AAPL",
      earliestTradeDate: null,
      latestTradeDate: null,
      recordCount: 0,
      availableRanges: [],
      missingTradingDays: 0,
      lastCsvImportedAt: null,
      lastApiSyncedAt: null,
    });
  });

  it("derives available ranges from the stored TRADING-day count", () => {
    // 130 real sessions back 1m/3m/6m (126) but NOT 1y (252).
    seedTradingDays("MSFT", "2026-06-26", 130);
    const coverage = coverageFor("MSFT");
    expect(coverage.recordCount).toBe(130);
    expect(coverage.availableRanges).toEqual(["1m", "3m", "6m"]);
    expect(coverage.availableRanges).not.toContain("1y");
  });

  it("does NOT treat a 252-row CSV padded with weekends as a full year", () => {
    // 252 CONSECUTIVE CALENDAR days ≈ 180 sessions: enough for 6m, NOT for 1y.
    seedConsecutive("WKND", "2026-06-26", 252);
    const coverage = coverageFor("WKND");
    expect(coverage.recordCount).toBe(252); // raw rows ARE 252…
    expect(coverage.availableRanges).toContain("6m");
    expect(coverage.availableRanges).not.toContain("1y"); // …but the year is not honestly backed
  });

  it("backs 1y only with ~252 real trading days", () => {
    seedTradingDays("FULL", "2026-06-26", 252);
    expect(coverageFor("FULL").availableRanges).toEqual(["1m", "3m", "6m", "1y"]);
  });

  it("backs 6m at 126 trading days but not 1y", () => {
    seedTradingDays("HALF", "2026-06-26", 126);
    const coverage = coverageFor("HALF");
    expect(coverage.availableRanges).toContain("6m");
    expect(coverage.availableRanges).not.toContain("1y");
  });

  it("counts missing trading days within the stored span", () => {
    // Store only Mon 06-22 and Fri 06-26 — the 3 trading days between them
    // (Tue/Wed/Thu) are missing.
    store.prices.upsertBars(
      [priceBar("GAP", "2026-06-22"), priceBar("GAP", "2026-06-26")],
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z"
    );
    // Mon..Fri inclusive = 5 expected trading days, 2 stored => 3 missing.
    expect(coverageFor("GAP").missingTradingDays).toBe(3);
  });

  it("reports no missing days for a fully consecutive trading window", () => {
    seedConsecutive("CONT", "2026-06-26", 5); // 06-22..06-26 (Mon..Fri), no gaps
    expect(coverageFor("CONT").missingTradingDays).toBe(0);
  });

  it("gives the SAME verdict whether the bars came from CSV or an API top-up", () => {
    seedTradingDays("CSVT", "2026-06-26", 252, "csv");
    seedTradingDays("APIT", "2026-06-26", 252, "api");
    const csv = coverageFor("CSVT");
    const api = coverageFor("APIT");
    expect(api.availableRanges).toEqual(csv.availableRanges);
    expect(api.recordCount).toBe(csv.recordCount);
    expect(api.missingTradingDays).toBe(csv.missingTradingDays);
  });

  it("surfaces last CSV-import and per-ticker API-sync timestamps when wired", () => {
    seedTradingDays("NVDA", "2026-06-26", 5);
    const runId = store.importRuns.start({
      sourceType: "csv",
      sourceName: "nvda.csv",
      startedAt: "2026-06-20T00:00:00.000Z",
    });
    store.importRuns.finish(runId, {
      status: "completed",
      finishedAt: "2026-06-20T01:00:00.000Z",
    });
    store.syncState.recordAttempt({
      ticker: "NVDA",
      attemptAt: "2026-06-21T00:00:00.000Z",
      result: "success",
      latestTradeDate: "2026-06-26",
      successAt: "2026-06-21T00:00:00.000Z",
    });
    const coverage = createDataCoverageService({
      priceRepository: store.prices,
      importRunRepository: store.importRuns,
      syncStateRepository: store.syncState,
      now: NOW,
    }).getCoverage("NVDA");
    expect(coverage.lastCsvImportedAt).toBe("2026-06-20T01:00:00.000Z");
    expect(coverage.lastApiSyncedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  it("lists coverage for every stored ticker", () => {
    seedTradingDays("AAA", "2026-06-26", 3);
    seedTradingDays("BBB", "2026-06-26", 3);
    const all = createDataCoverageService({ priceRepository: store.prices, now: NOW }).getAllCoverage();
    expect(all.map((c) => c.ticker)).toEqual(["AAA", "BBB"]);
  });
});
