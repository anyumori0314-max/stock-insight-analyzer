import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ALPHA_VANTAGE_COMPACT_TRADING_DAYS,
  createAlphaVantageProvider,
  createMockProvider,
  createSqliteProvider,
} from "../src/providers/adapters";
import { createHistoricalDataService } from "../src/services/historicalDataService";
import type { PriceBar } from "../src/domain/historical";
import { openTestStore, type TestStore } from "./historicalHelpers";

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
  vi.restoreAllMocks();
});

function priceBar(date: string, close: number): PriceBar {
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

describe("mock provider", () => {
  it("declares offline, no-key capabilities and performs ZERO network I/O", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = createMockProvider();
    expect(provider.capabilities).toMatchObject({
      id: "mock",
      requiresNetwork: false,
      requiresApiKey: false,
      isMock: true,
    });
    const result = await provider.fetchDailySeries("AAPL", "3m");
    expect(result.bars.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("supports the short windows the 80-bar fixture can back, but not 1y", () => {
    const provider = createMockProvider();
    expect(provider.capabilities.supportedRanges).toContain("1m");
    expect(provider.capabilities.supportedRanges).toContain("3m");
    expect(provider.capabilities.supportedRanges).not.toContain("1y");
  });
});

describe("alpha vantage provider", () => {
  it("declares network + key capabilities and only backs ranges within compact", () => {
    const provider = createAlphaVantageProvider({ apiKey: "test-key" });
    expect(provider.capabilities).toMatchObject({
      id: "alphaVantage",
      requiresNetwork: true,
      requiresApiKey: true,
      isMock: false,
      maxLookbackTradingDays: ALPHA_VANTAGE_COMPACT_TRADING_DAYS,
    });
    expect(provider.capabilities.supportedRanges).toContain("3m");
    expect(provider.capabilities.supportedRanges).not.toContain("6m");
    expect(provider.capabilities.supportedRanges).not.toContain("1y");
  });
});

describe("sqlite provider", () => {
  it("serves stored bars without network and supports every window capability-wise", async () => {
    store = openTestStore();
    const now = "2025-02-01T00:00:00.000Z";
    store.prices.upsertBars(
      [priceBar("2025-01-02", 100), priceBar("2025-01-03", 101), priceBar("2025-01-06", 102)],
      now,
      now
    );
    const provider = createSqliteProvider({
      historicalService: createHistoricalDataService({ priceRepository: store.prices }),
    });
    expect(provider.capabilities).toMatchObject({
      id: "sqlite",
      requiresNetwork: false,
      requiresApiKey: false,
      isMock: false,
    });
    expect(provider.capabilities.supportedRanges).toEqual(
      expect.arrayContaining(["1m", "3m", "6m", "1y"])
    );
    const series = await provider.fetchDailySeries("AAA", "3m");
    expect(series.bars).toHaveLength(3);
    expect(series.bars[series.bars.length - 1].close).toBe(102);
  });

  it("throws INSUFFICIENT_DATA when the store has no data for the ticker", async () => {
    store = openTestStore();
    const provider = createSqliteProvider({
      historicalService: createHistoricalDataService({ priceRepository: store.prices }),
    });
    await expect(provider.fetchDailySeries("ZZZ", "3m")).rejects.toMatchObject({
      code: "INSUFFICIENT_DATA",
    });
  });
});
