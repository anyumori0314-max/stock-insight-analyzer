import { describe, expect, it } from "vitest";

import { analyze, computeDataLimitations, computeScoreRationale } from "../src/analytics/analysis";
import type { StockMetrics } from "../src/types/report";

function metrics(overrides: Partial<StockMetrics> = {}): StockMetrics {
  return {
    currentPrice: 100,
    dailyChange: 1,
    dailyChangePercent: 1,
    periodReturnPercent: 5,
    sma20: 95,
    sma50: 90,
    rsi14: 55,
    annualizedVolatilityPercent: 18,
    maxDrawdownPercent: -5,
    macd: 1,
    macdSignal: 0.5,
    macdHistogram: 0.5,
    bollingerUpper: 110,
    bollingerMiddle: 100,
    bollingerLower: 90,
    volumeChangePercent: 10,
    sma20DeviationPercent: 5,
    sma50DeviationPercent: 11,
    ...overrides,
  };
}

describe("computeScoreRationale", () => {
  it("returns an empty rationale when the score is null", () => {
    expect(computeScoreRationale("unknown", "neutral", "low", null)).toEqual([]);
  });
  it("explains each contributing factor when the score is known", () => {
    const rationale = computeScoreRationale("uptrend", "neutral", "low", 100);
    expect(rationale.length).toBeGreaterThan(0);
    expect(rationale.join("\n")).toContain("上昇トレンド（+25）");
    expect(rationale.join("\n")).toContain("100");
  });
});

describe("computeDataLimitations", () => {
  it("reports nothing when all indicators are present", () => {
    expect(computeDataLimitations(metrics())).toEqual([]);
  });
  it("explains each uncomputable indicator (explicit null only)", () => {
    const limited = computeDataLimitations(
      metrics({ rsi14: null, sma50: null, macd: null, bollingerMiddle: null, annualizedVolatilityPercent: null })
    );
    expect(limited.join("\n")).toContain("RSI(14)");
    expect(limited.join("\n")).toContain("50日移動平均");
    expect(limited.join("\n")).toContain("MACD");
    expect(limited.join("\n")).toContain("ボリンジャーバンド");
  });
  it("prefers the MACD-signal reason when the line exists but the signal does not", () => {
    const limited = computeDataLimitations(metrics({ macd: 1, macdSignal: null }));
    expect(limited.join("\n")).toContain("MACDシグナル");
  });
  it("treats undefined (field not supplied) as 'not requested', not a limitation", () => {
    const bare: StockMetrics = {
      currentPrice: 100,
      dailyChange: null,
      dailyChangePercent: null,
      periodReturnPercent: null,
      sma20: 95,
      sma50: 90,
      rsi14: 55,
      annualizedVolatilityPercent: 18,
      maxDrawdownPercent: -5,
      // macd / bollinger intentionally undefined
    };
    expect(computeDataLimitations(bare)).toEqual([]);
  });
});

describe("analyze", () => {
  it("attaches rationale and limitations to the analysis", () => {
    const a = analyze(metrics());
    expect(a.scoreRationale!.length).toBeGreaterThan(0);
    expect(a.dataLimitations).toEqual([]);
  });
});
