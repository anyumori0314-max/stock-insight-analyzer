import { describe, expect, it } from "vitest";

import {
  annualizedVolatilityPct,
  dailyChange,
  dailyChangePercent,
  maxDrawdownPct,
  periodReturnPct,
  rsi,
  sma,
  smaSeries,
} from "../src/analytics/indicators";

describe("periodReturnPct", () => {
  it("computes the first-to-last percentage return", () => {
    expect(periodReturnPct([100, 110])).toBeCloseTo(10, 10);
    expect(periodReturnPct([100, 50, 75])).toBeCloseTo(-25, 10);
  });

  it("returns null with fewer than two points or a zero base", () => {
    expect(periodReturnPct([])).toBeNull();
    expect(periodReturnPct([100])).toBeNull();
    expect(periodReturnPct([0, 5])).toBeNull();
  });
});

describe("dailyChange / dailyChangePercent", () => {
  it("computes the day-over-day change from the last two closes", () => {
    expect(dailyChange([100, 104])).toBeCloseTo(4, 10);
    expect(dailyChangePercent([100, 104])).toBeCloseTo(4, 10);
    expect(dailyChange([120, 90, 99])).toBeCloseTo(9, 10);
    expect(dailyChangePercent([120, 90, 99])).toBeCloseTo(10, 10);
  });

  it("is null with fewer than two points or a zero prior close", () => {
    expect(dailyChange([100])).toBeNull();
    expect(dailyChangePercent([100])).toBeNull();
    expect(dailyChangePercent([0, 5])).toBeNull();
    expect(dailyChange([0, 5])).toBeCloseTo(5, 10); // absolute change is fine
  });
});

describe("finite-number guarantees (extreme inputs)", () => {
  it("never returns Infinity or NaN for huge / tiny / degenerate inputs", () => {
    const huge = [Number.MAX_VALUE, Number.MAX_VALUE / 2, Number.MAX_VALUE];
    const tiny = [1e-12, 2e-12, 1e-12, 3e-12];
    const results = [
      periodReturnPct(huge),
      dailyChange(huge),
      dailyChangePercent(huge),
      sma(huge, 2),
      rsi([...huge, ...huge, ...huge, ...huge, ...huge, ...huge]),
      annualizedVolatilityPct(tiny),
      maxDrawdownPct(huge),
    ];
    for (const value of results) {
      if (value !== null) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("smaSeries entries are finite or null (never NaN/Infinity)", () => {
    for (const value of smaSeries([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE], 2)) {
      expect(value === null || Number.isFinite(value)).toBe(true);
    }
  });
});

describe("sma", () => {
  it("averages the most recent `period` closes", () => {
    expect(sma([1, 2, 3, 4], 2)).toBeCloseTo(3.5, 10);
    expect(sma([2, 4, 6], 3)).toBeCloseTo(4, 10);
  });

  it("returns null until enough data is available", () => {
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([1, 2, 3], 0)).toBeNull();
  });
});

describe("smaSeries", () => {
  it("aligns a rolling average to the input, null until the window is full", () => {
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("is all-null when the window never fills", () => {
    expect(smaSeries([1, 2], 3)).toEqual([null, null]);
  });
});

describe("rsi", () => {
  it("returns null with fewer than period + 1 closes", () => {
    expect(rsi(new Array(14).fill(1))).toBeNull();
  });

  it("is 100 for a strictly rising series (no losses)", () => {
    const rising = Array.from({ length: 16 }, (_, i) => i + 1);
    expect(rsi(rising)).toBe(100);
  });

  it("is 0 for a strictly falling series (no gains)", () => {
    const falling = Array.from({ length: 16 }, (_, i) => 16 - i);
    expect(rsi(falling)).toBe(0);
  });

  it("is 50 for a perfectly flat series (no movement)", () => {
    expect(rsi(new Array(16).fill(5))).toBe(50);
  });

  it("matches a hand-computed value for a 15-point series", () => {
    // 14 deltas alternating +2 / -1: avgGain=1, avgLoss=0.5, RS=2 -> RSI=66.67.
    const closes = [100];
    for (let i = 0; i < 7; i += 1) {
      const prev = closes[closes.length - 1];
      closes.push(prev + 2, prev + 1);
    }
    expect(closes).toHaveLength(15);
    expect(rsi(closes)).toBeCloseTo(66.6667, 3);
  });
});

describe("annualizedVolatilityPct", () => {
  it("is 0 for a flat series and null with too few returns", () => {
    expect(annualizedVolatilityPct([5, 5, 5])).toBeCloseTo(0, 10);
    expect(annualizedVolatilityPct([1, 2])).toBeNull();
    expect(annualizedVolatilityPct([1])).toBeNull();
  });

  it("is positive for a varying series", () => {
    const vol = annualizedVolatilityPct([100, 105, 98, 110, 95]);
    expect(vol).not.toBeNull();
    expect(vol as number).toBeGreaterThan(0);
  });
});

describe("maxDrawdownPct", () => {
  it("computes the largest peak-to-trough decline as a non-positive percent", () => {
    expect(maxDrawdownPct([100, 120, 90, 110])).toBeCloseTo(-25, 10);
  });

  it("is 0 when prices never fall below a prior peak", () => {
    expect(maxDrawdownPct([100, 110, 120])).toBeCloseTo(0, 10);
  });

  it("returns null for an empty series", () => {
    expect(maxDrawdownPct([])).toBeNull();
  });
});
