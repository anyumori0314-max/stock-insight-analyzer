import { describe, expect, it } from "vitest";

import {
  analyze,
  analyzeMomentum,
  analyzeRisk,
  analyzeTrend,
  computeScore,
} from "../src/analytics/analysis";
import type { StockMetrics } from "../src/types/report";

function metrics(overrides: Partial<StockMetrics> = {}): StockMetrics {
  return {
    currentPrice: 100,
    dailyChange: null,
    dailyChangePercent: null,
    periodReturnPercent: null,
    sma20: null,
    sma50: null,
    rsi14: null,
    annualizedVolatilityPercent: null,
    maxDrawdownPercent: null,
    ...overrides,
  };
}

describe("analyzeTrend", () => {
  it("is uptrend when price > SMA20 > SMA50", () => {
    expect(analyzeTrend(metrics({ currentPrice: 110, sma20: 105, sma50: 100 }))).toBe("uptrend");
  });

  it("is downtrend when price < SMA20 < SMA50", () => {
    expect(analyzeTrend(metrics({ currentPrice: 90, sma20: 95, sma50: 100 }))).toBe("downtrend");
  });

  it("is sideways when the stack is mixed", () => {
    expect(analyzeTrend(metrics({ currentPrice: 102, sma20: 100, sma50: 105 }))).toBe("sideways");
  });

  it("is unknown when a moving average is missing", () => {
    expect(analyzeTrend(metrics({ currentPrice: 100, sma20: 100, sma50: null }))).toBe("unknown");
  });
});

describe("analyzeMomentum", () => {
  it("classifies RSI extremes and neutral", () => {
    expect(analyzeMomentum(metrics({ rsi14: 75 }))).toBe("overbought");
    expect(analyzeMomentum(metrics({ rsi14: 25 }))).toBe("oversold");
    expect(analyzeMomentum(metrics({ rsi14: 50 }))).toBe("neutral");
    expect(analyzeMomentum(metrics({ rsi14: null }))).toBe("unknown");
  });
});

describe("analyzeRisk", () => {
  it("is high when volatility or drawdown is elevated", () => {
    expect(analyzeRisk(metrics({ annualizedVolatilityPercent: 50, maxDrawdownPercent: -10 }))).toBe("high");
    expect(analyzeRisk(metrics({ annualizedVolatilityPercent: 25, maxDrawdownPercent: -35 }))).toBe("high");
  });

  it("is low only when both signals are calm", () => {
    expect(analyzeRisk(metrics({ annualizedVolatilityPercent: 10, maxDrawdownPercent: -5 }))).toBe("low");
  });

  it("is medium in between, unknown when data is missing", () => {
    expect(analyzeRisk(metrics({ annualizedVolatilityPercent: 25, maxDrawdownPercent: -20 }))).toBe("medium");
    expect(analyzeRisk(metrics({ annualizedVolatilityPercent: null }))).toBe("unknown");
  });
});

describe("computeScore", () => {
  it("is null when any dimension is unknown", () => {
    expect(computeScore("unknown", "neutral", "low")).toBeNull();
    expect(computeScore("uptrend", "unknown", "low")).toBeNull();
    expect(computeScore("uptrend", "neutral", "unknown")).toBeNull();
  });

  it("reaches the full 0–100 range and clamps", () => {
    expect(computeScore("uptrend", "neutral", "low")).toBe(100); // max
    expect(computeScore("downtrend", "overbought", "high")).toBe(0); // min
    expect(computeScore("sideways", "neutral", "medium")).toBe(65);
  });
});

describe("analyze", () => {
  it("produces verdicts, a score and three comments", () => {
    const result = analyze(
      metrics({
        currentPrice: 110,
        sma20: 105,
        sma50: 100,
        rsi14: 55,
        annualizedVolatilityPercent: 18,
        maxDrawdownPercent: -8,
      })
    );
    expect(result.trend).toBe("uptrend");
    expect(result.momentum).toBe("neutral");
    expect(result.risk).toBe("low");
    expect(result.score).toBe(100);
    expect(result.comments).toHaveLength(3);
  });

  it("keeps commentary descriptive, never advisory", () => {
    const advisoryPhrases = [
      "買うべき",
      "売るべき",
      "買い時",
      "必ず上がる",
      "必ず下がる",
      "絶対",
      "強く推奨",
      "利益が見込める",
      "投資すべき",
      "おすすめ",
      "推奨",
    ];
    const cases: StockMetrics[] = [
      metrics({ currentPrice: 110, sma20: 105, sma50: 100, rsi14: 80, annualizedVolatilityPercent: 50, maxDrawdownPercent: -40 }),
      metrics({ currentPrice: 90, sma20: 95, sma50: 100, rsi14: 20, annualizedVolatilityPercent: 12, maxDrawdownPercent: -5 }),
      metrics(),
    ];
    for (const m of cases) {
      for (const comment of analyze(m).comments) {
        for (const phrase of advisoryPhrases) {
          expect(comment).not.toContain(phrase);
        }
      }
    }
  });
});
