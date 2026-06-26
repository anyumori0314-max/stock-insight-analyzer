import { afterEach, describe, expect, it, vi } from "vitest";

import { createMarketDataProvider } from "../src/providers/factory";
import type { FetchLike } from "../src/services/alphaVantageClient";
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

function seedStore(): TestStore {
  const s = openTestStore();
  const now = "2025-02-01T00:00:00.000Z";
  s.prices.upsertBars([priceBar("2025-01-02", 100), priceBar("2025-01-03", 101)], now, now);
  return s;
}

/** A fake fetch returning a valid Alpha Vantage compact payload for `symbol`. */
function avFetch(symbol: string): FetchLike {
  const payload = {
    "Meta Data": {
      "1. Information": "Daily Prices",
      "2. Symbol": symbol,
      "3. Last Refreshed": "2026-06-19",
      "4. Output Size": "Compact",
      "5. Time Zone": "US/Eastern",
    },
    "Time Series (Daily)": {
      "2026-06-18": { "1. open": "10", "2. high": "11", "3. low": "9", "4. close": "10.5", "5. volume": "1000" },
      "2026-06-19": { "1. open": "10.5", "2. high": "12", "3. low": "10", "4. close": "11", "5. volume": "1100" },
    },
  };
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
  }));
}

describe("createMarketDataProvider", () => {
  it("mock mode returns an offline provider and performs ZERO network I/O", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = createMarketDataProvider({ dataMode: "mock" });
    expect(provider.capabilities.id).toBe("mock");
    await provider.fetchDailySeries("AAPL", "3m");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("historical mode returns the SQLite provider and requires the service", () => {
    store = seedStore();
    const provider = createMarketDataProvider({
      dataMode: "historical",
      historicalService: createHistoricalDataService({ priceRepository: store.prices }),
    });
    expect(provider.capabilities.id).toBe("sqlite");
    expect(() => createMarketDataProvider({ dataMode: "historical" })).toThrow();
  });

  it("live mode builds a resilient Alpha Vantage provider that uses the injected fetch", async () => {
    const fetchFn = avFetch("AAA");
    const provider = createMarketDataProvider({ dataMode: "live", apiKey: "k", fetchFn });
    expect(provider.capabilities.id).toBe("alphaVantage");
    const series = await provider.fetchDailySeries("AAA", "3m");
    expect(series.bars.length).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("hybrid mode without a key serves SQLite only (no network, no crash)", async () => {
    store = seedStore();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = createMarketDataProvider({
      dataMode: "hybrid",
      historicalService: createHistoricalDataService({ priceRepository: store.prices }),
    });
    expect(provider.capabilities.id).toBe("sqlite");
    const series = await provider.fetchDailySeries("AAA", "3m");
    expect(series.bars).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hybrid mode falls back to SQLite when the live provider fails", async () => {
    store = seedStore();
    const failingFetch: FetchLike = vi.fn(async () => {
      throw new Error("network down");
    });
    const hops: string[] = [];
    const provider = createMarketDataProvider({
      dataMode: "hybrid",
      apiKey: "k",
      fetchFn: failingFetch,
      historicalService: createHistoricalDataService({ priceRepository: store.prices }),
      onFallback: (h) => hops.push(`${h.fromId}->${h.toId}:${h.reason}`),
    });
    expect(provider.capabilities.id).toBe("composite");
    const series = await provider.fetchDailySeries("AAA", "3m");
    expect(series.bars).toHaveLength(2); // stored data served
    expect(hops).toContain("alphaVantage->sqlite:error");
  });
});
