import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDataFreshnessService } from "../src/services/dataFreshnessService";
import { createHistoricalDataService } from "../src/services/historicalDataService";
import { createMarketDataSyncService } from "../src/services/marketDataSyncService";
import { createCsvImportService } from "../src/services/csvImportService";
import { createStockService } from "../src/services/stockService";
import { createTtlCache } from "../src/services/ttlCache";
import { errorFor } from "../src/types/errors";
import type { AlphaVantageClient } from "../src/services/alphaVantageClient";
import type { StockReport } from "../src/types/report";
import type { DailyBar, StockDataMode, StockTimeSeries } from "../src/types/stock";
import { buildTestApp } from "./helpers";
import { openTestStore, type TestStore } from "./historicalHelpers";

const NOW = () => new Date("2026-06-23T12:00:00.000Z");
const HEADER = "ticker,date,open,high,low,close,volume";

/** A ~70-row CSV of ascending business days ending at `end`. */
function csvEndingAt(end: string, count = 70): string {
  const lines = [HEADER];
  const cursor = new Date(`${end}T00:00:00Z`);
  const rows: string[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.unshift(`AAPL,${cursor.toISOString().slice(0, 10)},10,12,9,11,1000`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return lines.concat(rows).join("\n");
}

function bar(date: string): DailyBar {
  return { date, open: 10, high: 12, low: 9, close: 11, adjustedClose: null, volume: 1000 };
}
function series(ticker: string, bars: DailyBar[]): StockTimeSeries {
  return { ticker, range: "3m", currency: null, timezone: "US/Eastern", lastRefreshed: bars.at(-1)?.date ?? null, priceBasis: "close", bars, warnings: [] };
}

let store: TestStore;
beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

function appFor(dataMode: StockDataMode, provider?: AlphaVantageClient) {
  const stockService = createStockService({
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
  return buildTestApp({ stockService });
}

function importCsv(content: string) {
  createCsvImportService({
    db: store.db,
    priceRepository: store.prices,
    importRunRepository: store.importRuns,
    limits: { maxRows: 1000, maxBytes: 1_000_000 },
  }).importContent(content, "seed.csv");
}

describe("integration: CSV -> SQLite -> stock service -> HTTP API", () => {
  it("serves an imported CSV through the historical API with data-status metadata", async () => {
    importCsv(csvEndingAt("2026-06-17"));
    const app = appFor("historical");

    const res = await request(app).get("/api/stock/AAPL?range=3m");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("historical");
    expect(res.body.dataStatus).toMatchObject({ dataMode: "historical", dataSource: "sqlite", persistent: true });
    expect(res.body.series.length).toBeGreaterThan(0);
  });

  it("serves the second request from cache (no re-read needed)", async () => {
    importCsv(csvEndingAt("2026-06-22"));
    const app = appFor("historical");

    const first = await request(app).get("/api/stock/AAPL?range=3m");
    expect(first.body.cache.hit).toBe(false);
    const second = await request(app).get("/api/stock/AAPL?range=3m");
    expect(second.body.cache.hit).toBe(true);
  });

  it("hybrid: supplements missing days from the provider and persists them", async () => {
    importCsv(csvEndingAt("2026-06-17"));
    const fetchDailySeries = vi.fn(async () => series("AAPL", [bar("2026-06-18"), bar("2026-06-22")]));
    const app = appFor("hybrid", { fetchDailySeries });

    const res = await request(app).get("/api/stock/AAPL?range=3m");
    expect(res.status).toBe(200);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    expect(res.body.dataStatus.dataSource).toBe("api");
    expect(store.prices.getLatestTradeDate("AAPL")).toBe("2026-06-22");
  });

  it("hybrid: falls back to SQLite when the provider fails (still HTTP 200)", async () => {
    importCsv(csvEndingAt("2026-06-17"));
    const fetchDailySeries = vi.fn(async () => {
      throw errorFor("PROVIDER_RATE_LIMITED");
    });
    const app = appFor("hybrid", { fetchDailySeries });

    const res = await request(app).get("/api/stock/AAPL?range=3m");
    expect(res.status).toBe(200);
    expect(res.body.dataStatus.fallbackUsed).toBe(true);
  });

  it("historical: a ticker with no stored data returns a safe 422 (no provider call)", async () => {
    const fetchDailySeries = vi.fn();
    const app = appFor("historical");
    const res = await request(app).get("/api/stock/TSLA?range=3m");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INSUFFICIENT_DATA");
    expect(fetchDailySeries).not.toHaveBeenCalled();
  });
});
