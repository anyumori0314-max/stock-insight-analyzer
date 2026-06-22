import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";
import type { StockService } from "../src/services/stockService";
import type { StockReport } from "../src/types/report";

// These tests exercise the rate limiters, not the stock data flow, so we inject
// a stock service that always succeeds. A normal (within-limit) request is then
// a clean 200, which the limiter converts to 429 once the budget is exhausted.
const okReport: StockReport = {
  ticker: "AAPL",
  source: "live",
  range: "3m",
  currency: null,
  timezone: "US/Eastern",
  lastRefreshed: "2026-06-19",
  priceBasis: "close",
  series: [],
  metrics: {
    currentPrice: 100,
    dailyChange: null,
    dailyChangePercent: null,
    periodReturnPercent: null,
    sma20: null,
    sma50: null,
    rsi14: null,
    annualizedVolatilityPercent: null,
    maxDrawdownPercent: null,
  },
  analysis: { trend: "unknown", momentum: "unknown", risk: "unknown", score: null, comments: [] },
  warnings: [],
  cache: { hit: false, expiresAt: null },
  disclaimer: "参考情報です。",
};
const okStockService: StockService = {
  getReport: async (ticker) => ({ ...okReport, ticker }),
};

// With `standardHeaders: "draft-7"`, express-rate-limit emits the combined
// `RateLimit` and `RateLimit-Policy` headers (lowercased by supertest). The
// legacy per-field `RateLimit-Limit/Remaining/Reset` are draft-6 only and are
// intentionally NOT asserted here.
function expectDraft7Headers(headers: Record<string, string | string[] | undefined>) {
  expect(headers["ratelimit"]).toBeDefined();
  expect(headers["ratelimit-policy"]).toBeDefined();
}

describe("Rate limiting — stock limiter", () => {
  it("returns 429 RATE_LIMITED once the stock limit is exceeded", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 2 },
      stockService: okStockService,
    });

    const first = await request(app).get("/api/stock/AAPL");
    const second = await request(app).get("/api/stock/AAPL");
    const third = await request(app).get("/api/stock/AAPL");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("exposes draft-7 RateLimit headers on a normal (non-throttled) response", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 5 },
      stockService: okStockService,
    });

    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(200); // within the limit
    expectDraft7Headers(res.headers);
  });

  it("includes Retry-After and draft-7 RateLimit headers on a 429", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 1 },
      stockService: okStockService,
    });

    await request(app).get("/api/stock/AAPL");
    const limited = await request(app).get("/api/stock/AAPL");

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();
    expectDraft7Headers(limited.headers);
  });

  it("does not leak limit state to a separate app instance", async () => {
    const app = buildTestApp({ stockService: okStockService });
    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(200);
  });
});

describe("Rate limiting — global API limiter", () => {
  it("returns 429 once the API-wide limit is exceeded (non-stock route)", async () => {
    // Hit an unknown /api path so only the global limiter is exercised.
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 2, stockLimit: 1_000 },
    });

    const first = await request(app).get("/api/unknown");
    const second = await request(app).get("/api/unknown");
    const third = await request(app).get("/api/unknown");

    expect(first.status).toBe(404); // unified not-found, within limit
    expect(second.status).toBe(404);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("keeps the global and stock limiters independent", async () => {
    // Exhaust the stock limiter; the global limiter still has headroom, and a
    // separate app instance is unaffected.
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 1 },
      stockService: okStockService,
    });

    await request(app).get("/api/stock/AAPL");
    const stockLimited = await request(app).get("/api/stock/AAPL");
    expect(stockLimited.status).toBe(429);

    const fresh = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 1 },
      stockService: okStockService,
    });
    const freshRes = await request(fresh).get("/api/stock/AAPL");
    expect(freshRes.status).toBe(200);
  });
});

describe("Rate limiting — health policy", () => {
  it("never throttles /api/health, even under a tiny limit", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1, stockLimit: 1 },
    });

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    }
  });

  it("is unaffected when the strict stock limiter is exhausted", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 1 },
      stockService: okStockService,
    });

    await request(app).get("/api/stock/AAPL");
    const stockLimited = await request(app).get("/api/stock/AAPL");
    expect(stockLimited.status).toBe(429);

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
  });
});

describe("Rate limiting — client identification behind a proxy", () => {
  it("buckets clients by X-Forwarded-For when TRUST_PROXY is set", async () => {
    const app = buildTestApp({
      env: { TRUST_PROXY: "1" },
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 1 },
      stockService: okStockService,
    });

    const a1 = await request(app).get("/api/stock/AAPL").set("X-Forwarded-For", "1.1.1.1");
    const a2 = await request(app).get("/api/stock/AAPL").set("X-Forwarded-For", "1.1.1.1");
    const b1 = await request(app).get("/api/stock/AAPL").set("X-Forwarded-For", "2.2.2.2");

    expect(a1.status).toBe(200); // first request for client A
    expect(a2.status).toBe(429); // client A exhausted its bucket
    expect(b1.status).toBe(200); // client B has its own bucket
  });

  it("ignores X-Forwarded-For when TRUST_PROXY is 0 (direct connection)", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1_000, stockLimit: 1 },
      stockService: okStockService,
    });

    const first = await request(app).get("/api/stock/AAPL").set("X-Forwarded-For", "1.1.1.1");
    const second = await request(app).get("/api/stock/AAPL").set("X-Forwarded-For", "2.2.2.2");

    expect(first.status).toBe(200);
    // The forged header is ignored, so both share the socket-address bucket.
    expect(second.status).toBe(429);
  });
});
