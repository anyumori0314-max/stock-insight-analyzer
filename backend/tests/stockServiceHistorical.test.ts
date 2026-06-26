import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stockReportSchema } from "../src/schemas/report";
import { createDataCoverageService } from "../src/services/dataCoverageService";
import type { AlphaVantageClient } from "../src/services/alphaVantageClient";
import { createDataFreshnessService } from "../src/services/dataFreshnessService";
import { createHistoricalDataService } from "../src/services/historicalDataService";
import { createMarketDataSyncService } from "../src/services/marketDataSyncService";
import { createStockService } from "../src/services/stockService";
import { createTtlCache } from "../src/services/ttlCache";
import { errorFor } from "../src/types/errors";
import type { StockReport } from "../src/types/report";
import type { DailyBar, StockDataMode, StockTimeSeries } from "../src/types/stock";
import { isTradingDay } from "../src/utils/marketCalendar";
import { openTestStore, type TestStore } from "./historicalHelpers";

const NOW = () => new Date("2026-06-23T12:00:00.000Z");

let store: TestStore;
beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

function bar(date: string, close = 11): DailyBar {
  return { date, open: 10, high: 12, low: 9, close, adjustedClose: null, volume: 1000 };
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
/**
 * Seeds `count` real TRADING days (weekends/holidays skipped) ending at `end`, so
 * the stored bar count equals the trading-day count — exactly what real history
 * looks like — and the trading-day-aware shortfall warning is deterministic.
 */
function seedHistory(end: string, count = 70) {
  const t = "2026-06-01T00:00:00.000Z";
  const bars = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  while (bars.length < count) {
    if (isTradingDay(cursor)) {
      bars.unshift({
        ticker: "AAPL",
        tradeDate: cursor.toISOString().slice(0, 10),
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        adjustedClose: null,
        volume: 1000,
        currency: null,
        source: "csv" as const,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  store.prices.upsertBars(bars, t, t);
}

/** Seeds `count` consecutive CALENDAR days (weekends INCLUDED) ending at `end`. */
function seedCalendarDays(end: string, count: number) {
  const t = "2026-06-01T00:00:00.000Z";
  const bars = [];
  const cursor = new Date(`${end}T00:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    bars.unshift({
      ticker: "AAPL",
      tradeDate: cursor.toISOString().slice(0, 10),
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      adjustedClose: null,
      volume: 1000,
      currency: null,
      source: "csv" as const,
    });
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  store.prices.upsertBars(bars, t, t);
}

function makeService(dataMode: StockDataMode, provider?: AlphaVantageClient) {
  return createStockService({
    dataMode,
    now: NOW,
    cache: createTtlCache<StockReport>({ ttlMs: 60_000, maxEntries: 50, now: () => NOW().getTime() }),
    historicalService: createHistoricalDataService({ priceRepository: store.prices }),
    freshnessService: createDataFreshnessService({ now: NOW }),
    priceRepository: store.prices,
    syncStateRepository: store.syncState,
    importRunRepository: store.importRuns,
    syncService: provider
      ? createMarketDataSyncService({
          provider,
          db: store.db,
          priceRepository: store.prices,
          syncStateRepository: store.syncState,
          staleAfterHours: 24,
          now: NOW,
        })
      : undefined,
  });
}

describe("createStockService — historical mode", () => {
  it("raises INSUFFICIENT_DATA when there is no stored data (never calls a provider)", async () => {
    await expect(makeService("historical").getReport("AAPL", "3m")).rejects.toMatchObject({
      code: "INSUFFICIENT_DATA",
    });
  });

  it("serves a contract-valid report from SQLite with historical data-status", async () => {
    seedHistory("2026-06-17");
    const report = await makeService("historical").getReport("AAPL", "3m");
    expect(stockReportSchema.safeParse(report).success).toBe(true);
    expect(report.source).toBe("historical");
    expect(report.dataStatus).toMatchObject({
      dataMode: "historical",
      dataSource: "sqlite",
      persistent: true,
      fallbackUsed: false,
      latestTradeDate: "2026-06-17",
      stale: true, // 06-17 is behind the latest completed trading day (06-22)
    });
    expect(report.dataStatus!.recordCount).toBeGreaterThan(0);
  });

  it("serves the second request from the in-memory cache (cache hit)", async () => {
    seedHistory("2026-06-22");
    const service = makeService("historical");
    const first = await service.getReport("AAPL", "3m");
    expect(first.cache.hit).toBe(false);
    const second = await service.getReport("AAPL", "3m");
    expect(second.cache.hit).toBe(true);
    expect(second.dataStatus?.dataMode).toBe("historical");
  });
});

describe("createStockService — long windows (6m / 1y) from SQLite (Phase 16)", () => {
  it("serves a full 6m and 1y window when enough history is stored (no shortfall warning)", async () => {
    seedHistory("2026-06-22", 260); // covers 1y (~252 sessions)
    const service = makeService("historical");
    for (const [range, want] of [
      ["6m", 126],
      ["1y", 252],
    ] as const) {
      const report = await service.getReport("AAPL", range);
      expect(stockReportSchema.safeParse(report).success).toBe(true);
      expect(report.range).toBe(range);
      expect(report.series.length).toBe(want);
      expect(report.warnings.join("\n")).not.toMatch(/利用可能な履歴は/);
    }
  });

  it("keeps the existing 1m / 3m behavior intact", async () => {
    seedHistory("2026-06-22", 260);
    const service = makeService("historical");
    expect((await service.getReport("AAPL", "1m")).series.length).toBe(21);
    expect((await service.getReport("AAPL", "3m")).series.length).toBe(63);
  });

  it("does NOT silently shorten an under-covered long window — it warns with the real count", async () => {
    seedHistory("2026-06-22", 80); // far fewer than the 252 a year needs
    const report = await makeService("historical").getReport("AAPL", "1y");
    expect(stockReportSchema.safeParse(report).success).toBe(true);
    expect(report.range).toBe("1y");
    expect(report.series.length).toBe(80);
    expect(report.warnings.join("\n")).toMatch(/1年.*252営業日.*80営業日/);
  });

  it("keeps coverage availableRanges and the report shortfall warning in agreement", async () => {
    // 252 CALENDAR days padded with weekends back ~180 sessions: NOT a real year.
    seedCalendarDays("2026-06-22", 252);
    const coverage = createDataCoverageService({
      priceRepository: store.prices,
      now: NOW,
    }).getCoverage("AAPL");
    const report = await makeService("historical").getReport("AAPL", "1y");

    // Coverage says 1y is not honestly backed AND the report carries the shortfall
    // warning — judged by the SAME trading-day measure, so they never contradict.
    expect(coverage.availableRanges).not.toContain("1y");
    expect(report.warnings.join("\n")).toMatch(/利用可能な履歴は/);
  });
});

describe("createStockService — hybrid mode", () => {
  it("supplements missing days from the provider, persists them, and serves the merged series", async () => {
    seedHistory("2026-06-17");
    const fetchDailySeries = vi.fn(async () =>
      series("AAPL", [bar("2026-06-18"), bar("2026-06-22")])
    );
    const report = await makeService("hybrid", { fetchDailySeries }).getReport("AAPL", "3m");
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    expect(report.source).toBe("hybrid");
    expect(report.dataStatus).toMatchObject({ dataSource: "api", fallbackUsed: false });
    // The new bars are now in SQLite.
    expect(store.prices.getLatestTradeDate("AAPL")).toBe("2026-06-22");
  });

  it("falls back to stored SQLite data when the provider fails", async () => {
    seedHistory("2026-06-17");
    const fetchDailySeries = vi.fn(async () => {
      throw errorFor("PROVIDER_RATE_LIMITED");
    });
    const report = await makeService("hybrid", { fetchDailySeries }).getReport("AAPL", "3m");
    expect(report.source).toBe("hybrid");
    expect(report.dataStatus).toMatchObject({ fallbackUsed: true, dataSource: "sqlite" });
    // Stored data is still served; nothing new was written.
    expect(store.prices.getLatestTradeDate("AAPL")).toBe("2026-06-17");
  });

  it("raises a safe error when there is no stored data AND the provider fails", async () => {
    const fetchDailySeries = vi.fn(async () => {
      throw errorFor("PROVIDER_TIMEOUT");
    });
    await expect(makeService("hybrid", { fetchDailySeries }).getReport("AAPL", "3m")).rejects.toMatchObject(
      { code: "PROVIDER_TIMEOUT" }
    );
  });
});
