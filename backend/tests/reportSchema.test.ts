import { describe, expect, it } from "vitest";

import { buildStockReport } from "../src/analytics/report";
import { stockReportSchema } from "../src/schemas/report";
import type { StockReport } from "../src/types/report";
import type { StockTimeSeries } from "../src/types/stock";

const baseSeries: StockTimeSeries = {
  ticker: "AAPL",
  range: "3m",
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

/** A valid public report with cache + source metadata stamped. */
function validReport(): StockReport {
  return {
    ...buildStockReport(baseSeries),
    source: "live",
    cache: { hit: false, expiresAt: "2026-06-19T00:05:00.000Z" },
  };
}

function rejects(report: unknown): boolean {
  return !stockReportSchema.safeParse(report).success;
}

describe("stockReportSchema — strict (no unknown fields)", () => {
  it("accepts a valid report", () => {
    expect(stockReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it("rejects a report carrying an unknown / internal field", () => {
    expect(rejects({ ...validReport(), secretInternal: "leak" })).toBe(true);
  });

  it("rejects a nested object with an unknown field (metrics)", () => {
    const report = validReport();
    expect(rejects({ ...report, metrics: { ...report.metrics, _debug: 1 } })).toBe(true);
  });
});

describe("stockReportSchema — source is required & enumerated", () => {
  it("rejects a missing source (no default fills it in)", () => {
    const report = validReport() as Partial<StockReport>;
    delete report.source;
    expect(rejects(report)).toBe(true);
  });

  it("rejects an invalid source", () => {
    expect(rejects({ ...validReport(), source: "fake" })).toBe(true);
  });

  it("accepts both live and mock", () => {
    expect(stockReportSchema.safeParse({ ...validReport(), source: "mock" }).success).toBe(true);
  });
});

describe("stockReportSchema — range enum", () => {
  it("accepts every supported window and rejects unsupported ones", () => {
    // 1m/3m everywhere; 6m/1y now backed by the SQLite history store (Phase 16).
    for (const range of ["1m", "3m", "6m", "1y"]) {
      expect(stockReportSchema.safeParse({ ...validReport(), range }).success).toBe(true);
    }
    expect(rejects({ ...validReport(), range: "100d" })).toBe(true);
    expect(rejects({ ...validReport(), range: "30d" })).toBe(true);
    expect(rejects({ ...validReport(), range: "2y" })).toBe(true);
    expect(rejects({ ...validReport(), range: "5y" })).toBe(true);
    expect(rejects({ ...validReport(), range: "max" })).toBe(true);
  });
});

describe("stockReportSchema — real dates & cache timestamps", () => {
  it("rejects an impossible series date", () => {
    const report = validReport();
    const series = [{ ...report.series[0], date: "2026-02-30" }, report.series[1]];
    expect(rejects({ ...report, series })).toBe(true);
  });

  it("rejects an impossible lastRefreshed but accepts null", () => {
    expect(rejects({ ...validReport(), lastRefreshed: "2026-13-01" })).toBe(true);
    expect(stockReportSchema.safeParse({ ...validReport(), lastRefreshed: null }).success).toBe(true);
  });

  it("rejects an invalid cache.expiresAt but accepts a real instant or null", () => {
    expect(rejects({ ...validReport(), cache: { hit: false, expiresAt: "2026-99-99T99:99:99Z" } })).toBe(
      true
    );
    expect(
      stockReportSchema.safeParse({ ...validReport(), cache: { hit: true, expiresAt: null } }).success
    ).toBe(true);
  });
});
