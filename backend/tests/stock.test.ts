import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestApp } from "./helpers";
import { tickerSchema } from "../src/schemas/stock";
import { stockReportSchema } from "../src/schemas/report";
import type { StockReport } from "../src/types/report";
import type { StockRange } from "../src/types/stock";
import type { StockService } from "../src/services/stockService";

/** Minimal contract-valid report stub. */
function makeReport(ticker: string, range: StockRange = "3m"): StockReport {
  return {
    ticker,
    source: "live",
    range,
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: "2026-06-19",
    priceBasis: "close",
    series: [
      { date: "2026-06-19", open: 100, high: 105, low: 99, close: 104, adjustedClose: null, volume: 1000, sma20: null, sma50: null },
    ],
    metrics: {
      currentPrice: 104,
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
    cache: { hit: false, expiresAt: "2026-06-19T00:05:00.000Z" },
    disclaimer: "参考情報です。",
  };
}

describe("GET /api/stock/:ticker", () => {
  it("returns 503 API_KEY_MISSING when no API key / service is configured", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("API_KEY_MISSING");
  });

  it("returns 200 with a contract-valid report (service injected)", async () => {
    const getReport = vi.fn(async (ticker: string, range?: StockRange) => makeReport(ticker, range));
    const app = buildTestApp({ stockService: { getReport } });

    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe("AAPL");
    expect(res.body.metrics.currentPrice).toBe(104);
    expect(stockReportSchema.safeParse(res.body).success).toBe(true);
    expect(getReport).toHaveBeenCalledWith("AAPL", "3m");
  });

  it("normalizes a lowercase ticker before calling the service", async () => {
    const getReport = vi.fn(async (ticker: string, range?: StockRange) => makeReport(ticker, range));
    const app = buildTestApp({ stockService: { getReport } });

    const res = await request(app).get("/api/stock/aapl");

    expect(res.status).toBe(200);
    expect(getReport).toHaveBeenCalledWith("AAPL", "3m");
  });

  it("passes a supported ?range= through and reflects it in the report", async () => {
    const getReport = vi.fn(async (ticker: string, range?: StockRange) => makeReport(ticker, range));
    const app = buildTestApp({ stockService: { getReport } });

    const res = await request(app).get("/api/stock/AAPL?range=1m");

    expect(res.status).toBe(200);
    expect(getReport).toHaveBeenCalledWith("AAPL", "1m");
    expect(res.body.range).toBe("1m");
  });

  it("rejects an unsupported ?range= with 400 INVALID_RANGE", async () => {
    const getReport = vi.fn(async (ticker: string, range?: StockRange) => makeReport(ticker, range));
    const app = buildTestApp({ stockService: { getReport } });

    const res = await request(app).get("/api/stock/AAPL?range=2y");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RANGE");
    expect(getReport).not.toHaveBeenCalled();
  });

  it("rejects the now-unsupported 6m / 1y windows with 400 INVALID_RANGE (never fetched)", async () => {
    const getReport = vi.fn(async (ticker: string, range?: StockRange) => makeReport(ticker, range));
    const app = buildTestApp({ stockService: { getReport } });

    for (const range of ["6m", "1y"]) {
      const res = await request(app).get(`/api/stock/AAPL?range=${range}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_RANGE");
    }
    expect(getReport).not.toHaveBeenCalled();
  });

  it("rejects empty / whitespace ticker with 400 INVALID_TICKER", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/%20");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TICKER");
  });

  it("rejects invalid characters with 400 INVALID_TICKER", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/INVALID!!!");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TICKER");
  });

  it("rejects a too-long ticker with 400 INVALID_TICKER", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/ABCDEFGHIJKLMNOP");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TICKER");
  });

  it("rejects path-traversal-like input (never served as a ticker)", async () => {
    const app = buildTestApp();
    const cases = [
      "/api/stock/%2e%2e", // ".."
      "/api/stock/%2e%2e%2f%2e%2e%2fetc", // "../../etc"
      "/api/stock/AB%2fCD", // "AB/CD" (embedded slash)
    ];

    for (const url of cases) {
      const res = await request(app).get(url);
      expect([400, 404]).toContain(res.status);
      expect(["INVALID_TICKER", "NOT_FOUND"]).toContain(res.body.error.code);
    }
  });
});

describe("tickerSchema — accepted forms (normalized to uppercase)", () => {
  const accepted: Array<[string, string]> = [
    ["AAPL", "AAPL"],
    ["aapl", "AAPL"],
    ["  aapl ", "AAPL"],
    ["BRK.B", "BRK.B"],
    ["brk.b", "BRK.B"],
    ["BRK-B", "BRK-B"],
    ["BF.A", "BF.A"],
    ["ABCDEFGHIJ", "ABCDEFGHIJ"],
  ];

  it.each(accepted)("accepts %j -> %j", (input, expected) => {
    expect(tickerSchema.parse(input)).toBe(expected);
  });
});

describe("tickerSchema — rejected forms", () => {
  const rejected: Array<[string, string]> = [
    ["empty string", ""],
    ["whitespace only", "   "],
    ["11 characters", "ABCDEFGHIJK"],
    ["leading traversal", "../AAPL"],
    ["encoded traversal", "%2E%2E%2FAAPL"],
    ["embedded slash", "RDS/A"],
    ["double dot", ".."],
    ["leading separator", "-AAPL"],
    ["trailing separator", "AAPL."],
    ["consecutive separators", "AA..PL"],
    ["japanese", "日本語"],
    ["fullwidth alnum", "ＡＡＰＬ"],
    ["latin small long s (folds to S)", "ſ"],
    ["dotless i (folds to I)", "ı"],
    ["NUL control character", "AA" + String.fromCharCode(0) + "PL"],
    ["tab control character", "AA\tPL"],
    ["embedded space", "AA PL"],
    ["disallowed symbol", "AAPL!"],
  ];

  it.each(rejected)("rejects %s", (_label, input) => {
    expect(tickerSchema.safeParse(input).success).toBe(false);
  });

  it("rejects Unicode look-alikes that would fold to ASCII when uppercased", () => {
    expect("ſ".toUpperCase()).toBe("S");
    expect(tickerSchema.safeParse("ſ").success).toBe(false);
    expect(tickerSchema.safeParse("ı").success).toBe(false);
  });
});
