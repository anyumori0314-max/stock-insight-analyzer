import type { StockReport } from "../types/stock";

/** Builds a contract-valid report for use in component/hook/API tests. */
export function makeReport(overrides: Partial<StockReport> = {}): StockReport {
  return {
    ticker: "AAPL",
    source: "live",
    range: "100d",
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: "2026-06-19",
    priceBasis: "close",
    series: [
      { date: "2026-06-18", open: 98, high: 101, low: 97, close: 100, adjustedClose: null, volume: 900, sma20: null, sma50: null },
      { date: "2026-06-19", open: 100, high: 106, low: 99, close: 104, adjustedClose: null, volume: 1000, sma20: null, sma50: null },
    ],
    metrics: {
      currentPrice: 104,
      dailyChange: 4,
      dailyChangePercent: 4,
      periodReturnPercent: 4,
      sma20: null,
      sma50: null,
      rsi14: 55,
      annualizedVolatilityPercent: 18,
      maxDrawdownPercent: -3,
    },
    analysis: {
      trend: "uptrend",
      momentum: "neutral",
      risk: "low",
      score: 100,
      comments: ["上昇基調の傾向が見られます。", "RSIは中立的な水準にあります。"],
    },
    warnings: [],
    cache: { hit: false, expiresAt: "2026-06-19T00:05:00.000Z" },
    disclaimer: "参考情報です。投資助言ではありません。",
    ...overrides,
  };
}

/** A fetch Response-like stub. */
export function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}
