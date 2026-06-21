import { describe, expect, it, vi } from "vitest";

import { createStockService } from "../src/services/stockService";
import type { AlphaVantageClient } from "../src/services/alphaVantageClient";
import { ApiError } from "../src/types/errors";
import type { StockTimeSeries } from "../src/types/stock";

function seriesFor(ticker: string, range = "100d"): StockTimeSeries {
  return {
    ticker,
    range,
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: "2026-06-19",
    priceBasis: "close",
    warnings: [],
    bars: [
      { date: "2026-06-18", open: 98, high: 101, low: 97, close: 100, adjustedClose: null, volume: 900 },
      { date: "2026-06-19", open: 100, high: 105, low: 99, close: 104, adjustedClose: null, volume: 1000 },
    ],
  };
}

/** A deferred promise so we can hold provider calls open during a test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createStockService — configuration", () => {
  it("throws 503 API_KEY_MISSING when no client / API key is configured", async () => {
    const service = createStockService();
    await expect(service.getReport("AAPL")).rejects.toMatchObject({
      status: 503,
      code: "API_KEY_MISSING",
    });
  });
});

describe("createStockService — reports & cache", () => {
  it("builds a report from the client's series (miss -> cache.hit false)", async () => {
    const client: AlphaVantageClient = {
      fetchDailySeries: vi.fn(async (ticker: string) => seriesFor(ticker)),
    };
    const report = await createStockService({ client }).getReport("AAPL");

    expect(report.ticker).toBe("AAPL");
    expect(report.metrics.currentPrice).toBe(104);
    expect(report.metrics.dailyChange).toBeCloseTo(4, 10);
    expect(report.series).toHaveLength(2);
    expect(report.cache.hit).toBe(false);
    expect(report.cache.expiresAt).toBeTypeOf("string");
    expect(report.disclaimer).toMatch(/投資助言/);
  });

  it("serves repeated requests from cache (hit, no second provider call)", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries } });

    const first = await service.getReport("AAPL");
    const second = await service.getReport("AAPL");

    expect(first.cache.hit).toBe(false);
    expect(second.cache.hit).toBe(true);
    expect(second.cache.expiresAt).toBeTypeOf("string");
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by ticker AND range", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string, range?: string) => seriesFor(ticker, range));
    const service = createStockService({ client: { fetchDailySeries } });

    await service.getReport("AAPL", "100d");
    await service.getReport("AAPL", "1y");

    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
  });

  it("does not cross-contaminate different tickers", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries } });

    const a = await service.getReport("AAPL");
    const b = await service.getReport("MSFT");

    expect(a.ticker).toBe("AAPL");
    expect(b.ticker).toBe("MSFT");
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
  });
});

describe("createStockService — in-flight de-duplication", () => {
  it("coalesces 10 concurrent requests for the same key into ONE provider call", async () => {
    const gate = deferred<void>();
    const fetchDailySeries = vi.fn(async (ticker: string) => {
      await gate.promise;
      return seriesFor(ticker);
    });
    const service = createStockService({ client: { fetchDailySeries } });

    const pending = Array.from({ length: 10 }, () => service.getReport("AAPL"));
    gate.resolve();
    const results = await Promise.all(pending);

    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ticker === "AAPL")).toBe(true);
  });

  it("keeps different tickers independent under concurrency", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries } });

    await Promise.all([service.getReport("AAPL"), service.getReport("MSFT")]);
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
  });
});

describe("createStockService — failure handling", () => {
  it("does not cache failures; clears in-flight and retries on the next call", async () => {
    const fetchDailySeries = vi
      .fn<AlphaVantageClient["fetchDailySeries"]>()
      .mockRejectedValueOnce(new ApiError(502, "PROVIDER_UNAVAILABLE", "down"))
      .mockResolvedValueOnce(seriesFor("AAPL"));
    const service = createStockService({ client: { fetchDailySeries } });

    await expect(service.getReport("AAPL")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const ok = await service.getReport("AAPL"); // retry succeeds
    expect(ok.ticker).toBe("AAPL");
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
  });

  it("rejects all coalesced callers when the single provider call fails", async () => {
    const fetchDailySeries = vi.fn(async () => {
      throw new ApiError(429, "PROVIDER_RATE_LIMITED", "slow down");
    });
    const service = createStockService({ client: { fetchDailySeries } });

    const results = await Promise.allSettled([
      service.getReport("AAPL"),
      service.getReport("AAPL"),
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
  });
});
