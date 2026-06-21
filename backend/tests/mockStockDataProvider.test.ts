import { describe, expect, it, vi } from "vitest";

import {
  createMockStockDataProvider,
  generateMockSeries,
  isUsMarketHoliday,
  MOCK_ANCHOR_DATE,
} from "../src/services/mockStockDataProvider";
import { createStockService } from "../src/services/stockService";
import { buildStockReport } from "../src/analytics/report";
import { stockReportSchema } from "../src/schemas/report";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses an ISO date as UTC midnight (avoids local-timezone day shifts). */
function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function dayOfWeek(date: string): number {
  return utc(date).getUTCDay();
}

describe("generateMockSeries — deterministic fixtures", () => {
  it("produces a stable series for the same ticker (no wall-clock dependency)", () => {
    const a = generateMockSeries("AAPL");
    const b = generateMockSeries("AAPL");
    expect(a).toEqual(b);
  });

  it("produces different series for different tickers", () => {
    const aapl = generateMockSeries("AAPL");
    const msft = generateMockSeries("MSFT");
    expect(aapl.bars).not.toEqual(msft.bars);
  });

  it("returns 60–100 OHLC-consistent daily bars with integer volume", () => {
    const { bars } = generateMockSeries("NVDA");
    expect(bars.length).toBeGreaterThanOrEqual(60);
    expect(bars.length).toBeLessThanOrEqual(100);

    for (const bar of bars) {
      expect(bar.date).toMatch(ISO_DATE);
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
      expect(bar.high).toBeGreaterThanOrEqual(bar.open);
      expect(bar.high).toBeGreaterThanOrEqual(bar.close);
      expect(bar.low).toBeLessThanOrEqual(bar.open);
      expect(bar.low).toBeLessThanOrEqual(bar.close);
      expect(bar.open).toBeGreaterThan(0);
      expect(Number.isInteger(bar.volume)).toBe(true);
      expect(bar.volume).toBeGreaterThanOrEqual(0);
    }

    // Strictly ascending by date.
    const dates = bars.map((b) => b.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("uses an anchor that is a real trading day (weekday, not a holiday)", () => {
    expect(MOCK_ANCHOR_DATE).toMatch(ISO_DATE);
    const dow = dayOfWeek(MOCK_ANCHOR_DATE);
    expect(dow).not.toBe(0); // not Sunday
    expect(dow).not.toBe(6); // not Saturday
    expect(isUsMarketHoliday(utc(MOCK_ANCHOR_DATE))).toBe(false);

    // The most recent generated bar is the anchor day.
    const { bars } = generateMockSeries("AAPL");
    expect(bars[bars.length - 1].date).toBe(MOCK_ANCHOR_DATE);
  });

  it("excludes weekends and known US market holidays, with unique ascending dates", () => {
    const dates = generateMockSeries("AAPL").bars.map((b) => b.date);

    for (const date of dates) {
      const dow = dayOfWeek(date);
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
      expect(isUsMarketHoliday(utc(date))).toBe(false);
    }

    // No duplicates and strictly increasing.
    expect(new Set(dates).size).toBe(dates.length);
    for (let i = 1; i < dates.length; i += 1) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it("recognises representative 2026 US market holidays (incl. Juneteenth)", () => {
    expect(isUsMarketHoliday(utc("2026-06-19"))).toBe(true); // Juneteenth (old anchor)
    expect(isUsMarketHoliday(utc("2026-01-01"))).toBe(true); // New Year's Day
    expect(isUsMarketHoliday(utc("2026-05-25"))).toBe(true); // Memorial Day (last Mon May)
    expect(isUsMarketHoliday(utc("2026-04-03"))).toBe(true); // Good Friday
    expect(isUsMarketHoliday(utc("2026-11-26"))).toBe(true); // Thanksgiving (4th Thu Nov)
    expect(isUsMarketHoliday(utc("2026-06-17"))).toBe(false); // a normal trading day
  });

  it("yields a report whose indicators (SMA20/50, RSI14) are computable", () => {
    const report = buildStockReport(generateMockSeries("MSFT"));
    expect(stockReportSchema.safeParse(report).success).toBe(true);
    expect(report.metrics.sma20).not.toBeNull();
    expect(report.metrics.sma50).not.toBeNull();
    expect(report.metrics.rsi14).not.toBeNull();
    expect(report.series.length).toBeGreaterThanOrEqual(60);
  });
});

describe("createStockService — mock data mode", () => {
  it("serves reports without an API key and stamps source = mock", async () => {
    const service = createStockService({ dataMode: "mock" });
    const report = await service.getReport("AAPL");

    expect(report.source).toBe("mock");
    expect(report.ticker).toBe("AAPL");
    expect(report.series.length).toBeGreaterThanOrEqual(60);
  });

  it("does not call the real provider / network in mock mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const service = createStockService({ dataMode: "mock" });

    await service.getReport("AAPL");
    await service.getReport("MSFT");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("stamps source = live when using a (fake) live client", async () => {
    const client = createMockStockDataProvider(); // any client; mode drives source
    const report = await createStockService({ client, dataMode: "live" }).getReport("AAPL");
    expect(report.source).toBe("live");
  });
});
