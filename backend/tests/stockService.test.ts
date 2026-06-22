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

function seriesFor(ticker: string, range: StockRange = "3m"): StockTimeSeries {
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

  it("defaults to the 3m window and caches by ticker:range", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries } });

    const first = await service.getReport("AAPL");
    const second = await service.getReport("AAPL");

    expect(first.range).toBe("3m");
    expect(second.cache.hit).toBe(true);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
  });

  it("treats different ranges as separate cache keys (one fetch per range)", async () => {
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries } });

    const oneMonth = await service.getReport("AAPL", "1m");
    const threeMonth = await service.getReport("AAPL", "3m");
    const oneMonthAgain = await service.getReport("AAPL", "1m");

    expect(oneMonth.range).toBe("1m");
    expect(threeMonth.range).toBe("3m");
    // 1m and 3m are distinct keys (2 fetches); the repeat 1m is a cache hit.
    expect(fetchDailySeries).toHaveBeenCalledTimes(2);
    expect(oneMonthAgain.cache.hit).toBe(true);
  });

  it("1m and 3m slice the same compact fetch to genuinely different lengths", async () => {
    // A 70-bar compact series: 1m keeps ~21, 3m keeps ~63 — different periods.
    const bars = Array.from({ length: 70 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String((i % 12) + 1).padStart(2, "0");
      return { date: `2026-${month}-${day}`, open: 100, high: 101, low: 99, close: 100, adjustedClose: null, volume: 1000 };
    });
    const series: StockTimeSeries = { ...seriesFor("AAPL"), bars };
    const fetchDailySeries = vi.fn(async () => series);
    const service = createStockService({ client: { fetchDailySeries } });

    const oneMonth = await service.getReport("AAPL", "1m");
    const threeMonth = await service.getReport("AAPL", "3m");

    expect(oneMonth.series).toHaveLength(21);
    expect(threeMonth.series).toHaveLength(63);
    expect(oneMonth.series.length).not.toBe(threeMonth.series.length);
  });

  it("warns when a (short) provider series cannot fully back the window", async () => {
    // seriesFor returns only 2 bars, far short of 3m (~63): served as-is + warned,
    // never fabricated beyond what exists.
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const report = await createStockService({ client: { fetchDailySeries } }).getReport("AAPL", "3m");

    expect(report.range).toBe("3m");
    expect(report.series).toHaveLength(2); // not fabricated beyond what exists
    expect(report.warnings.some((w) => w.includes("利用可能な履歴"))).toBe(true);
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

describe("createStockService — persistent (two-layer) cache", () => {
  type Mode = "live" | "mock";
  function memoryRepo() {
    const store = new Map<string, { report: StockReport; expiresAtMs: number }>();
    const get = vi.fn(async (ticker: string, range: StockRange, dataMode: Mode) =>
      store.get(`${ticker}:${range}:${dataMode}`) ?? null
    );
    const set = vi.fn(
      async (ticker: string, range: StockRange, dataMode: Mode, report: StockReport, expiresAtMs: number) => {
        store.set(`${ticker}:${range}:${dataMode}`, { report, expiresAtMs });
      }
    );
    const del = vi.fn(async (ticker: string, range: StockRange, dataMode: Mode) => {
      store.delete(`${ticker}:${range}:${dataMode}`);
    });
    return { get, set, delete: del, store };
  }

  it("writes a successful report to the persistent repository (ticker:range)", async () => {
    const repo = memoryRepo();
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    await createStockService({ client: { fetchDailySeries }, reportRepository: repo }).getReport(
      "AAPL",
      "1m"
    );

    expect(repo.set).toHaveBeenCalledTimes(1);
    expect(repo.set.mock.calls[0][0]).toBe("AAPL");
    expect(repo.set.mock.calls[0][1]).toBe("1m");
    expect(repo.set.mock.calls[0][2]).toBe("live"); // dataMode is persisted
  });

  it("serves a persistent hit WITHOUT calling the provider (survives memory loss)", async () => {
    const repo = memoryRepo();
    const fetch1 = vi.fn(async (ticker: string) => seriesFor(ticker));
    await createStockService({ client: { fetchDailySeries: fetch1 }, reportRepository: repo }).getReport(
      "AAPL",
      "3m"
    );
    expect(fetch1).toHaveBeenCalledTimes(1);

    // A FRESH service (empty memory) sharing the same repo must not re-fetch.
    const fetch2 = vi.fn(async (ticker: string) => seriesFor(ticker));
    const fresh = createStockService({ client: { fetchDailySeries: fetch2 }, reportRepository: repo });
    const report = await fresh.getReport("AAPL", "3m");

    expect(report.cache.hit).toBe(true);
    expect(fetch2).not.toHaveBeenCalled();
  });

  it("does not fail the request when a persistent write throws (memory-only fallback)", async () => {
    const repo = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new Error("disk full");
      }),
      delete: vi.fn(async () => {}),
    };
    const fetchDailySeries = vi.fn(async (ticker: string) => seriesFor(ticker));
    const service = createStockService({ client: { fetchDailySeries }, reportRepository: repo });

    const report = await service.getReport("AAPL", "3m");
    expect(report.ticker).toBe("AAPL");
    expect(report.cache.hit).toBe(false);
  });

  it("does not serve a persistent entry written in a DIFFERENT mode (re-fetches)", async () => {
    const repo = memoryRepo();
    // Save under MOCK mode only.
    await createStockService({ dataMode: "mock", reportRepository: repo }).getReport("AAPL", "3m");
    expect(repo.set).toHaveBeenCalledWith("AAPL", "3m", "mock", expect.anything(), expect.any(Number));

    // A LIVE service must NOT read the mock entry: it re-fetches via the provider.
    const fetchLive = vi.fn(async (ticker: string) => seriesFor(ticker));
    const live = createStockService({
      client: { fetchDailySeries: fetchLive },
      dataMode: "live",
      reportRepository: repo,
    });
    const report = await live.getReport("AAPL", "3m");

    expect(report.source).toBe("live");
    expect(report.cache.hit).toBe(false);
    expect(fetchLive).toHaveBeenCalledTimes(1);
  });

  it("serves a same-mode persistent hit WITHOUT calling the provider (mode match)", async () => {
    const repo = memoryRepo();
    await createStockService({ dataMode: "mock", reportRepository: repo }).getReport("AAPL", "3m");

    const fetch2 = vi.fn(async (ticker: string) => seriesFor(ticker));
    const fresh = createStockService({
      client: { fetchDailySeries: fetch2 },
      dataMode: "mock",
      reportRepository: repo,
    });
    const report = await fresh.getReport("AAPL", "3m");

    expect(report.source).toBe("mock");
    expect(report.cache.hit).toBe(true);
    expect(fetch2).not.toHaveBeenCalled();
  });
});

describe("createStockService — persistent hit validation & mode integrity", () => {
  /** A repo whose get() returns a caller-controlled persisted entry once. */
  function fixedRepo(report: unknown) {
    return {
      get: vi.fn(async () => ({ report: report as StockReport, expiresAtMs: Date.now() + 60_000 })),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
  }

  function validReport(source: "live" | "mock"): StockReport {
    return {
      ticker: "AAPL",
      source,
      range: "3m",
      currency: null,
      timezone: "US/Eastern",
      lastRefreshed: "2026-06-19",
      priceBasis: "close",
      series: [
        { date: "2026-06-19", open: 100, high: 105, low: 99, close: 104, adjustedClose: null, volume: 1000, sma20: null, sma50: null },
      ],
      metrics: {
        currentPrice: 104, dailyChange: null, dailyChangePercent: null, periodReturnPercent: null,
        sma20: null, sma50: null, rsi14: null, annualizedVolatilityPercent: null, maxDrawdownPercent: null,
      },
      analysis: { trend: "unknown", momentum: "unknown", risk: "unknown", score: null, comments: [] },
      warnings: [],
      cache: { hit: false, expiresAt: "2026-06-19T00:05:00.000Z" },
      disclaimer: "参考情報です。",
    };
  }

  it("does NOT promote an INVALID persistent report into memory, deletes it, and re-fetches", async () => {
    // A persisted report missing a required field fails assertPublicReport.
    const { ticker: _omit, ...invalid } = validReport("live");
    const repo = fixedRepo(invalid);
    const cache = createTtlCache<StockReport>({ ttlMs: 60_000, maxEntries: 10 });
    const setSpy = vi.spyOn(cache, "set");
    const fetchDailySeries = vi.fn(async (t: string) => seriesFor(t));
    const service = createStockService({ client: { fetchDailySeries }, reportRepository: repo, cache });

    const report = await service.getReport("AAPL", "3m");

    expect(repo.delete).toHaveBeenCalledTimes(1); // invalid disk entry removed
    expect(fetchDailySeries).toHaveBeenCalledTimes(1); // provider re-fetched
    expect(report.cache.hit).toBe(false);
    // The only memory write is the freshly fetched, valid report (not the invalid one).
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0][1]).toBe(report);
  });

  it("rejects a persisted report whose source contradicts the active mode (no live-washing of mock)", async () => {
    // A mock-sourced report somehow returned while running live -> must be dropped,
    // never re-published as source:"live".
    const repo = fixedRepo(validReport("mock"));
    const fetchDailySeries = vi.fn(async (t: string) => seriesFor(t));
    const live = createStockService({
      client: { fetchDailySeries },
      dataMode: "live",
      reportRepository: repo,
    });

    const report = await live.getReport("AAPL", "3m");

    expect(repo.delete).toHaveBeenCalledTimes(1);
    expect(fetchDailySeries).toHaveBeenCalledTimes(1);
    expect(report.source).toBe("live"); // freshly fetched, NOT the mock entry re-labelled
  });

  it("promotes a VALID same-mode persistent report into memory and preserves its source", async () => {
    const repo = fixedRepo(validReport("live"));
    const cache = createTtlCache<StockReport>({ ttlMs: 60_000, maxEntries: 10 });
    const setSpy = vi.spyOn(cache, "set");
    const fetchDailySeries = vi.fn(async (t: string) => seriesFor(t));
    const service = createStockService({ client: { fetchDailySeries }, reportRepository: repo, cache });

    const report = await service.getReport("AAPL", "3m");

    expect(fetchDailySeries).not.toHaveBeenCalled(); // served from disk
    expect(report.cache.hit).toBe(true);
    expect(report.source).toBe("live");
    expect(setSpy).toHaveBeenCalledTimes(1); // promoted into memory
    expect(stockReportSchema.safeParse(report).success).toBe(true);
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
      range: "3m",
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
    expect(cache.has("AAPL:3m")).toBe(false);

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
