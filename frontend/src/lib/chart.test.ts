import { describe, expect, it } from "vitest";

import { MAX_CHART_POINTS, prepareChartData } from "./chart";
import type { StockPricePoint } from "../types/stock";

function bar(date: string, close: number): StockPricePoint {
  return { date, open: close, high: close, low: close, close, adjustedClose: null, volume: 1, sma20: null, sma50: null };
}

function series(n: number): StockPricePoint[] {
  return Array.from({ length: n }, (_, i) => bar(`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, i));
}

describe("prepareChartData", () => {
  it("returns the SAME array reference when within the cap (no copy/sort)", () => {
    const input = series(50);
    expect(prepareChartData(input)).toBe(input);
  });

  it("handles empty and single-point series", () => {
    const empty: StockPricePoint[] = [];
    expect(prepareChartData(empty)).toBe(empty);
    const one = series(1);
    expect(prepareChartData(one)).toBe(one);
  });

  it("down-samples an oversized series to at most the cap", () => {
    const out = prepareChartData(series(5000), 100);
    expect(out.length).toBeLessThanOrEqual(101); // cap + possibly the appended last bar
    expect(out.length).toBeGreaterThan(0);
  });

  it("always keeps the most recent bar when down-sampling", () => {
    const input = series(5000);
    const out = prepareChartData(input, 100);
    expect(out[out.length - 1]).toBe(input[input.length - 1]);
  });

  it("never down-samples a realistic 1-year daily series (≈252 bars)", () => {
    const input = series(252);
    expect(prepareChartData(input)).toBe(input);
    expect(MAX_CHART_POINTS).toBeGreaterThan(252);
  });
});
