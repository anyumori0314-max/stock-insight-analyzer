import { describe, expect, it, vi } from "vitest";

import { assertPublicReport, createStockService } from "../src/services/stockService";
import { createTtlCache } from "../src/services/ttlCache";
import type { AlphaVantageClient } from "../src/services/alphaVantageClient";
import { stockReportSchema } from "../src/schemas/report";
import { ApiError } from "../src/types/errors";
import type { StockReport } from "../src/types/report";
import type { StockRange, StockTimeSeries } from "../src/types/stock";

/** Runs `fn`, returning the thrown value (or undefined if it did not throw). */
function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

function seriesFor(ticker: string, range: StockRange = "100d"): StockTimeSeries {
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

  it("fixes the range to 100d and caches by ticker (no second window)", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries } });

    const first = await service.getReport("AAPL");
    const second = await service.getReport("AAPL");

    // Range is always "100d", and the second call is served from cache.
    expect(first.range).toBe("100d");
    expect(second.cache.hit).toBe(true);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
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

describe("createStockService — final public-response validation", () => {
  it("returns a contract-valid report and stamps an ISO-8601 cache expiry", async () => {
    const client: AlphaVantageClient = {
      fetchDailySeries: vi.fn(async (ticker: string) => seriesFor(ticker)),
    };
    const report = await createStockService({ client }).getReport("AAPL");

    // assertPublicReport is the guard withMeta runs; it returns a VALIDATED copy
    // (a fresh object, never the caller's), equal in value to a valid report.
    const validated = assertPublicReport(report);
    expect(validated).toStrictEqual(report);
    expect(validated).not.toBe(report);
    expect(report.cache.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
  });

  it("converts a non-finite metric to a safe PROVIDER_RESPONSE_INVALID", async () => {
    const client: AlphaVantageClient = {
      fetchDailySeries: vi.fn(async (ticker: string) => seriesFor(ticker)),
    };
    const report = await createStockService({ client }).getReport("AAPL");

    const bad = { ...report, metrics: { ...report.metrics, currentPrice: Number.NaN } };
    expect(caught(() => assertPublicReport(bad))).toMatchObject({
      status: 502,
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("rejects malformed cache metadata (invalid expiresAt)", async () => {
    const client: AlphaVantageClient = {
      fetchDailySeries: vi.fn(async (ticker: string) => seriesFor(ticker)),
    };
    const report = await createStockService({ client }).getReport("AAPL");

    const bad = { ...report, cache: { hit: false, expiresAt: "not-a-date" } };
    expect(caught(() => assertPublicReport(bad))).toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("rejects a report carrying an unknown internal field (strict schema)", async () => {
    const client: AlphaVantageClient = {
      fetchDailySeries: vi.fn(async (ticker: string) => seriesFor(ticker)),
    };
    const report = await createStockService({ client }).getReport("AAPL");

    const leaky = { ...report, internalSecret: "do-not-leak" };
    expect(caught(() => assertPublicReport(leaky))).toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("both a cache-hit report and a mock report satisfy the strict public schema", async () => {
    const live = createStockService({
      client: { fetchDailySeries: vi.fn(async (ticker: string) => seriesFor(ticker)) },
    });
    await live.getReport("AAPL"); // miss -> caches
    const cacheHit = await live.getReport("AAPL"); // hit
    expect(cacheHit.cache.hit).toBe(true);
    expect(stockReportSchema.safeParse(cacheHit).success).toBe(true);

    const mockReport = await createStockService({ dataMode: "mock" }).getReport("MSFT");
    expect(mockReport.source).toBe("mock");
    expect(stockReportSchema.safeParse(mockReport).success).toBe(true);
  });
});

describe("createStockService — validates BEFORE caching (no poisoned cache)", () => {
  /** A series whose built report violates the public schema (impossible date). */
  function seriesWithBadDate(ticker: string): StockTimeSeries {
    return {
      ticker,
      range: "100d",
      currency: null,
      timezone: "US/Eastern",
      lastRefreshed: "2026-06-19",
      priceBasis: "close",
      warnings: [],
      bars: [
        { date: "2026-02-30", open: 100, high: 101, low: 99, close: 100, adjustedClose: null, volume: 1000 },
      ],
    };
  }

  it("fails the 1st call, stores nothing, and re-fetches the provider on the 2nd call", async () => {
    const cache = createTtlCache<StockReport>({ ttlMs: 60_000, maxEntries: 10 });
    const setSpy = vi.spyOn(cache, "set");
    const fetchDailySeries = vi
      .fn<AlphaVantageClient["fetchDailySeries"]>()
      .mockResolvedValueOnce(seriesWithBadDate("AAPL"))
      .mockResolvedValueOnce(seriesFor("AAPL"));
    const service = createStockService({ client: { fetchDailySeries }, cache });

    // 1) Invalid report -> safe error, and 2)/3) nothing cached.
    await expect(service.getReport("AAPL")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_RESPONSE_INVALID",
    });
    expect(setSpy).not.toHaveBeenCalled();
    expect(cache.has("AAPL:100d")).toBe(false);

    // 4)/5) No cache hit -> provider called again -> succeeds.
    const ok = await service.getReport("AAPL");
    expect(ok.ticker).toBe("AAPL");
    expect(ok.cache.hit).toBe(false);
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
  });

  it("caches the exact validated object and re-validates it on a cache hit", async () => {
    const cache = createTtlCache<StockReport>({ ttlMs: 60_000, maxEntries: 10 });
    const setSpy = vi.spyOn(cache, "set");
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries }, cache });

    // 6) A valid report is cached as usual.
    const miss = await service.getReport("AAPL");
    expect(miss.cache.hit).toBe(false);
    expect(setSpy).toHaveBeenCalledTimes(1);
    // The object handed to cache.set IS the validated object returned to the caller.
    expect(setSpy.mock.calls[0][1]).toBe(miss);

    // 7) Cache hit re-validates and returns a contract-valid report (hit=true).
    const hit = await service.getReport("AAPL");
    expect(hit.cache.hit).toBe(true);
    expect(stockReportSchema.safeParse(hit).success).toBe(true);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
  });
});
