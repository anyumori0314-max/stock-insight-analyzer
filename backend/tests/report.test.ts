import { describe, expect, it } from "vitest";

import { buildStockReport } from "../src/analytics/report";
import { stockReportSchema } from "../src/schemas/report";
import type { DailyBar, StockTimeSeries } from "../src/types/stock";

function makeBar(date: string, close: number): DailyBar {
  return {
    date,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    adjustedClose: null,
    volume: 1000,
  };
}

function makeSeries(closes: number[]): StockTimeSeries {
  const bars = closes.map((close, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return makeBar(day, close);
  });
  return {
    ticker: "AAPL",
    range: "100d",
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: "2026-06-19",
    priceBasis: "close",
    warnings: [],
    bars,
  };
}

describe("buildStockReport — contract", () => {
  it("produces a payload that satisfies the public zod contract", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10 + i * 0.2);
    const report = buildStockReport(makeSeries(closes));

    const parsed = stockReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);

    expect(report.priceBasis).toBe("close");
    expect(report.currency).toBeNull();
    expect(report.series).toHaveLength(60);
    expect(report.metrics.currentPrice).toBe(closes[closes.length - 1]);
    expect(report.metrics.dailyChange).not.toBeNull();
    expect(report.series.every((p) => p.adjustedClose === null)).toBe(true);
  });

  it("includes a limited-history warning when fewer than 50 bars", () => {
    const report = buildStockReport(makeSeries([100, 101, 102]));
    expect(report.warnings.some((w) => w.includes("履歴"))).toBe(true);
    // SMA50 cannot be computed from 3 bars.
    expect(report.metrics.sma50).toBeNull();
  });

  it("contains no NaN/Infinity even for extreme prices (finite or null only)", () => {
    const closes = [Number.MAX_VALUE, Number.MAX_VALUE / 2, Number.MAX_VALUE, 1e-9, Number.MAX_VALUE];
    const report = buildStockReport(makeSeries(closes));

    // The contract schema rejects any non-finite number, so passing it proves
    // there is no smuggled NaN/Infinity.
    expect(stockReportSchema.safeParse(report).success).toBe(true);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("Infinity");
    expect(serialized).not.toContain("NaN");
  });

  it("carries provider warnings through to the report", () => {
    const series = makeSeries([100, 101]);
    series.warnings = ["重複した日付が1件ありました。"];
    const report = buildStockReport(series);
    expect(report.warnings).toContain("重複した日付が1件ありました。");
  });
});
