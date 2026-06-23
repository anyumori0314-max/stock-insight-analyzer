import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlphaVantageClient } from "../src/services/alphaVantageClient";
import { createMarketDataSyncService } from "../src/services/marketDataSyncService";
import { errorFor } from "../src/types/errors";
import type { DailyBar, StockRange, StockTimeSeries } from "../src/types/stock";
import { openTestStore, type TestStore } from "./historicalHelpers";

// Tue 2026-06-23 -> latest completed trading day is Mon 2026-06-22.
const NOW = () => new Date("2026-06-23T12:00:00.000Z");
const STALE_HOURS = 24;

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

function seed(dates: string[]) {
  const t = "2026-06-01T00:00:00.000Z";
  store.prices.upsertBars(
    dates.map((d) => ({
      ticker: "AAPL",
      tradeDate: d,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      adjustedClose: null,
      volume: 1000,
      currency: null,
      source: "csv" as const,
    })),
    t,
    t
  );
}

function makeService(provider: AlphaVantageClient) {
  return createMarketDataSyncService({
    provider,
    db: store.db,
    priceRepository: store.prices,
    syncStateRepository: store.syncState,
    staleAfterHours: STALE_HOURS,
    now: NOW,
  });
}

describe("MarketDataSyncService", () => {
  it("does NOT call the provider when SQLite is already current", async () => {
    seed(["2026-06-22"]); // == latest completed trading day
    const fetchDailySeries = vi.fn();
    const outcome = await makeService({ fetchDailySeries }).sync("AAPL", "3m");
    expect(fetchDailySeries).not.toHaveBeenCalled();
    expect(outcome.result).toBe("skipped");
    expect(store.syncState.get("AAPL")?.lastResult).toBe("skipped");
  });

  it("calls the provider once when behind and upserts only NEW dates", async () => {
    seed(["2026-06-17"]);
    const fetchDailySeries = vi.fn(async () =>
      series("AAPL", [bar("2026-06-17"), bar("2026-06-18"), bar("2026-06-22")])
    );
    const outcome = await makeService({ fetchDailySeries }).sync("AAPL", "3m");
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    expect(outcome.result).toBe("success");
    expect(outcome.syncedDates).toEqual(["2026-06-18", "2026-06-22"]);
    // The existing 2026-06-17 row is not duplicated.
    expect(store.prices.countBars("AAPL")).toBe(3);
    const inserted = store.prices.getBars("AAPL").find((b) => b.tradeDate === "2026-06-22");
    expect(inserted?.source).toBe("api");
    expect(store.syncState.get("AAPL")).toMatchObject({ lastResult: "success", latestTradeDate: "2026-06-22" });
  });

  it("coalesces concurrent same-ticker syncs onto ONE provider call", async () => {
    seed(["2026-06-17"]);
    const fetchDailySeries = vi.fn(async () => series("AAPL", [bar("2026-06-22")]));
    const service = makeService({ fetchDailySeries });
    const [a, b] = await Promise.all([service.sync("AAPL", "1m"), service.sync("AAPL", "1m")]);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    expect(a.result).toBe("success");
    expect(b.result).toBe("success");
  });

  it("runs concurrent SAME-ticker DIFFERENT-range syncs independently (one call each)", async () => {
    seed(["2026-06-17"]);
    const fetchDailySeries = vi.fn(async (_ticker: string, range?: StockRange) =>
      series("AAPL", range === "1m" ? [bar("2026-06-22", 11)] : [bar("2026-06-22", 10)])
    );
    const service = makeService({ fetchDailySeries });
    const [a, b] = await Promise.all([service.sync("AAPL", "1m"), service.sync("AAPL", "3m")]);
    // Distinct (ticker, range) keys -> NOT coalesced: exactly one call per range.
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
    expect(fetchDailySeries.mock.calls.map((c) => c[1]).sort()).toEqual(["1m", "3m"]);
    expect(a.result).toBe("success");
    expect(b.result).toBe("success");
  });

  it("coalesces requests that differ only by ticker case / whitespace", async () => {
    seed(["2026-06-17"]);
    const fetchDailySeries = vi.fn(async () => series("AAPL", [bar("2026-06-22")]));
    const service = makeService({ fetchDailySeries });
    const [a, b, c] = await Promise.all([
      service.sync("AAPL", "1m"),
      service.sync("aapl", "1m"),
      service.sync("  AaPl  ", "1m"),
    ]);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    // The provider/repository always see the canonical (trimmed, uppercase) symbol.
    expect(fetchDailySeries).toHaveBeenCalledWith("AAPL", "1m");
    expect([a.result, b.result, c.result]).toEqual(["success", "success", "success"]);
  });

  it("can re-run the same ticker:range after a provider failure (no stuck in-flight entry)", async () => {
    seed(["2026-06-17"]);
    let attempt = 0;
    const fetchDailySeries = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw errorFor("PROVIDER_TIMEOUT");
      return series("AAPL", [bar("2026-06-22")]);
    });
    // staleAfterHours: 0 so the recent-attempt window never suppresses the retry;
    // we are asserting the in-flight map clears after a rejection, not the policy.
    const service = createMarketDataSyncService({
      provider: { fetchDailySeries },
      db: store.db,
      priceRepository: store.prices,
      syncStateRepository: store.syncState,
      staleAfterHours: 0,
      now: NOW,
    });
    const first = await service.sync("AAPL", "1m");
    expect(first.result).toBe("failed");
    const second = await service.sync("AAPL", "1m");
    expect(second.result).toBe("success");
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
  });

  it("a finished range's cleanup does not evict a still in-flight different range", async () => {
    seed(["2026-06-17"]);
    // A 3m provider call that stays pending until we resolve it by hand.
    let resolve3m!: (s: StockTimeSeries) => void;
    const pending3m = new Promise<StockTimeSeries>((res) => {
      resolve3m = res;
    });
    const fetchDailySeries = vi.fn((_ticker: string, range?: StockRange) =>
      range === "1m" ? Promise.resolve(series("AAPL", [bar("2026-06-22", 11)])) : pending3m
    );
    const service = makeService({ fetchDailySeries });
    const p3m = service.sync("AAPL", "3m"); // pending: provider not yet resolved
    const a1m = await service.sync("AAPL", "1m"); // completes -> its finally deletes ONLY "AAPL:1m"
    expect(a1m.result).toBe("success");
    // If the 1m cleanup had wrongly removed "AAPL:3m", this duplicate would start a
    // SECOND 3m provider call; it must instead coalesce onto the still-tracked p3m.
    const p3mDup = service.sync("AAPL", "3m");
    resolve3m(series("AAPL", [bar("2026-06-22", 10)]));
    const [b3m, b3mDup] = await Promise.all([p3m, p3mDup]);
    expect(b3m.result).toBe("success");
    expect(b3mDup.result).toBe("success");
    // Exactly one 1m call + exactly one 3m call (the duplicate 3m was coalesced).
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
    expect(fetchDailySeries.mock.calls.filter((c) => c[1] === "3m")).toHaveLength(1);
  });

  it("does NOT auto-retry after a rate-limit failure (and stores no bars)", async () => {
    seed(["2026-06-17"]);
    const fetchDailySeries = vi.fn(async () => {
      throw errorFor("PROVIDER_RATE_LIMITED");
    });
    const service = makeService({ fetchDailySeries });
    const first = await service.sync("AAPL", "3m");
    expect(first.result).toBe("failed");
    expect(first.errorCode).toBe("PROVIDER_RATE_LIMITED");
    expect(store.prices.countBars("AAPL")).toBe(1); // unchanged

    // A second immediate attempt is suppressed (same-window) -> no second call.
    const second = await service.sync("AAPL", "3m");
    expect(second.result).toBe("skipped");
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
  });

  it("records a failed sync on provider timeout and keeps stored data intact", async () => {
    seed(["2026-06-17", "2026-06-18"]);
    const fetchDailySeries = vi.fn(async () => {
      throw errorFor("PROVIDER_TIMEOUT");
    });
    const outcome = await makeService({ fetchDailySeries }).sync("AAPL", "3m");
    expect(outcome.result).toBe("failed");
    expect(outcome.errorCode).toBe("PROVIDER_TIMEOUT");
    expect(store.prices.countBars("AAPL")).toBe(2);
    expect(store.syncState.get("AAPL")?.lastErrorCode).toBe("PROVIDER_TIMEOUT");
  });

  it("never stores an invalid provider payload", async () => {
    seed(["2026-06-17"]);
    // high < low -> inconsistent OHLC.
    const badBar: DailyBar = { date: "2026-06-22", open: 10, high: 5, low: 9, close: 8, adjustedClose: null, volume: 100 };
    const fetchDailySeries = vi.fn(async () => series("AAPL", [badBar]));
    const outcome = await makeService({ fetchDailySeries }).sync("AAPL", "3m");
    expect(outcome.result).toBe("failed");
    expect(outcome.errorCode).toBe("PROVIDER_RESPONSE_INVALID");
    expect(store.prices.countBars("AAPL")).toBe(1);
  });

  it("treats different tickers independently", async () => {
    seed(["2026-06-17"]); // AAPL behind
    const fetchDailySeries = vi.fn(async (ticker: string) =>
      series(ticker, [bar("2026-06-22")])
    );
    const service = makeService({ fetchDailySeries });
    await service.sync("AAPL", "3m");
    await service.sync("MSFT", "3m");
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
    expect(store.prices.getLatestTradeDate("MSFT")).toBe("2026-06-22");
  });
});
