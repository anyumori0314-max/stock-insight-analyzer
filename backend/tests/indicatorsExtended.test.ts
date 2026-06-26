import { describe, expect, it } from "vitest";

import {
  bollingerBands,
  ema,
  macd,
  movingAverageDeviationPct,
  volumeChangePct,
} from "../src/analytics/indicators";

describe("ema", () => {
  it("returns the constant value for a flat series", () => {
    expect(ema([5, 5, 5, 5], 2)).toBe(5);
  });
  it("returns null when there are fewer than `period` points", () => {
    expect(ema([1], 2)).toBeNull();
  });
});

describe("macd", () => {
  it("reports null for the line until ~slow points, and null signal until ~slow+signal", () => {
    const short = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(macd(short)).toEqual({ macd: null, signal: null, histogram: null });

    const medium = Array.from({ length: 30 }, (_, i) => 100 + i); // >= slow(26), < slow+signal
    const m = macd(medium);
    expect(m.macd).not.toBeNull();
    expect(m.signal).toBeNull();
    expect(m.histogram).toBeNull();
  });

  it("computes a finite line, signal and histogram once enough data exists", () => {
    const long = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(long);
    expect(Number.isFinite(m.macd!)).toBe(true);
    expect(Number.isFinite(m.signal!)).toBe(true);
    expect(Number.isFinite(m.histogram!)).toBe(true);
    // For a steadily rising series the fast EMA leads the slow EMA -> MACD > 0.
    expect(m.macd!).toBeGreaterThan(0);
    // histogram == macd - signal
    expect(m.histogram!).toBeCloseTo(m.macd! - m.signal!, 6);
  });
});

describe("bollingerBands", () => {
  it("returns all-null until `period` points are available", () => {
    expect(bollingerBands([1, 2, 3], 20)).toEqual({ middle: null, upper: null, lower: null });
  });
  it("collapses the bands to the mean for a flat window (sd = 0)", () => {
    const flat = new Array(20).fill(50);
    expect(bollingerBands(flat, 20, 2)).toEqual({ middle: 50, upper: 50, lower: 50 });
  });
  it("places the bands symmetrically around the mean", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 10 + i);
    const b = bollingerBands(closes, 20, 2);
    expect(b.middle).not.toBeNull();
    expect(b.upper! - b.middle!).toBeCloseTo(b.middle! - b.lower!, 6);
    expect(b.upper!).toBeGreaterThan(b.middle!);
    expect(b.lower!).toBeLessThan(b.middle!);
  });
});

describe("volumeChangePct", () => {
  it("computes day-over-day percent change", () => {
    expect(volumeChangePct([100, 150])).toBe(50);
    expect(volumeChangePct([200, 100])).toBe(-50);
  });
  it("returns null for < 2 points or a zero prior volume", () => {
    expect(volumeChangePct([100])).toBeNull();
    expect(volumeChangePct([0, 100])).toBeNull();
  });
});

describe("movingAverageDeviationPct", () => {
  it("is zero when the last close equals its SMA", () => {
    expect(movingAverageDeviationPct([10, 10, 10], 3)).toBe(0);
  });
  it("is positive when price is above the average", () => {
    const d = movingAverageDeviationPct([10, 10, 13], 3);
    expect(d!).toBeGreaterThan(0);
  });
  it("returns null when the SMA is not computable", () => {
    expect(movingAverageDeviationPct([10, 10], 3)).toBeNull();
  });
});
