import type {
  MomentumVerdict,
  RiskVerdict,
  StockAnalysis,
  StockMetrics,
  TrendVerdict,
} from "../types/report";

/**
 * Rule-based analysis (Phase 6).
 *
 * Turns the numeric metrics into qualitative verdicts, a composite reference
 * score, and human-readable commentary. Everything here is intentionally
 * DESCRIPTIVE, not prescriptive: the wording reports what the indicators show
 * ("〜の傾向が見られます") and never tells the user to buy or sell. This keeps
 * the public-facing product an information tool rather than investment advice.
 */

// --- Thresholds (kept as named constants so they are easy to review/tune) ----
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;
export const VOLATILITY_HIGH_PCT = 40;
export const VOLATILITY_LOW_PCT = 20;
export const DRAWDOWN_HIGH_PCT = -30;
export const DRAWDOWN_LOW_PCT = -15;

/**
 * Trend from the price's position relative to its moving averages. A clean
 * stack (price > SMA20 > SMA50) is an uptrend, the inverse a downtrend, and
 * anything mixed is treated as sideways. Missing averages -> "unknown".
 */
export function analyzeTrend(metrics: StockMetrics): TrendVerdict {
  const { currentPrice, sma20, sma50 } = metrics;
  if (currentPrice === null || sma20 === null || sma50 === null) {
    return "unknown";
  }
  if (currentPrice > sma20 && sma20 > sma50) {
    return "uptrend";
  }
  if (currentPrice < sma20 && sma20 < sma50) {
    return "downtrend";
  }
  return "sideways";
}

/** Momentum from RSI(14). */
export function analyzeMomentum(metrics: StockMetrics): MomentumVerdict {
  const { rsi14 } = metrics;
  if (rsi14 === null) {
    return "unknown";
  }
  if (rsi14 >= RSI_OVERBOUGHT) {
    return "overbought";
  }
  if (rsi14 <= RSI_OVERSOLD) {
    return "oversold";
  }
  return "neutral";
}

/**
 * Risk from annualized volatility and maximum drawdown. "High" if either signal
 * is elevated; "low" only if both are calm; "medium" otherwise.
 */
export function analyzeRisk(metrics: StockMetrics): RiskVerdict {
  const { annualizedVolatilityPercent: vol, maxDrawdownPercent: dd } = metrics;
  if (vol === null || dd === null) {
    return "unknown";
  }
  if (vol >= VOLATILITY_HIGH_PCT || dd <= DRAWDOWN_HIGH_PCT) {
    return "high";
  }
  if (vol < VOLATILITY_LOW_PCT && dd > DRAWDOWN_LOW_PCT) {
    return "low";
  }
  return "medium";
}

/**
 * Composite 0–100 "technical state" reference value combining the three
 * verdicts. Returns `null` if any dimension is unknown (too little data).
 *
 * This is NOT a buy/sell signal — it merely summarizes how aligned the
 * indicators currently are. The weights are chosen so the value can actually
 * reach both bounds (unlike a narrow 5–95 band): the calmest aligned state
 * (uptrend + neutral momentum + low risk) reaches 100, and the most stressed
 * (downtrend + overbought + high risk) reaches 0. Output is clamped for safety.
 */
export function computeScore(
  trend: TrendVerdict,
  momentum: MomentumVerdict,
  risk: RiskVerdict
): number | null {
  if (trend === "unknown" || momentum === "unknown" || risk === "unknown") {
    return null;
  }

  let score = 50;

  score += trend === "uptrend" ? 25 : trend === "downtrend" ? -25 : 0;

  // Both RSI extremes reduce "stability"; a neutral reading is the calmest.
  score += momentum === "neutral" ? 15 : momentum === "overbought" ? -15 : -10;

  score += risk === "low" ? 10 : risk === "high" ? -10 : 0;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function trendComment(trend: TrendVerdict): string {
  switch (trend) {
    case "uptrend":
      return "直近の終値が移動平均線（20日・50日）を上回っており、上昇基調の傾向が見られます。";
    case "downtrend":
      return "直近の終値が移動平均線（20日・50日）を下回っており、下落基調の傾向が見られます。";
    case "sideways":
      return "終値と移動平均線が交錯しており、方向感の乏しい横ばいの状態が見られます。";
    default:
      return "移動平均を算出できる十分なデータがないため、トレンドは判定できません。";
  }
}

function momentumComment(momentum: MomentumVerdict, rsi: number | null): string {
  const value = rsi === null ? "—" : rsi.toFixed(1);
  switch (momentum) {
    case "overbought":
      return `RSI(14)は${value}と高めの水準にあり、短期的な過熱感が見られます。`;
    case "oversold":
      return `RSI(14)は${value}と低めの水準にあり、短期的な売られ過ぎの傾向が見られます。`;
    case "neutral":
      return `RSI(14)は${value}と中立的な水準にあります。`;
    default:
      return "RSIを算出できる十分なデータがないため、過熱感は判定できません。";
  }
}

function riskComment(
  risk: RiskVerdict,
  vol: number | null,
  drawdown: number | null
): string {
  const volText = vol === null ? "—" : `${vol.toFixed(1)}%`;
  const ddText = drawdown === null ? "—" : `${drawdown.toFixed(1)}%`;
  switch (risk) {
    case "high":
      return `年率ボラティリティ${volText}・最大下落率${ddText}と変動が大きく、価格変動リスクは高めの水準が見られます。`;
    case "low":
      return `年率ボラティリティ${volText}・最大下落率${ddText}と変動は比較的小さく、価格変動リスクは低めの水準が見られます。`;
    case "medium":
      return `年率ボラティリティ${volText}・最大下落率${ddText}と、価格変動リスクは標準的な水準が見られます。`;
    default:
      return "ボラティリティを算出できる十分なデータがないため、リスクは判定できません。";
  }
}

/**
 * Per-factor rationale explaining HOW the composite score was reached (base 50
 * plus each verdict's contribution). Empty when the score is null. Descriptive,
 * never advisory — it mirrors the weights used in {@link computeScore}.
 */
export function computeScoreRationale(
  trend: TrendVerdict,
  momentum: MomentumVerdict,
  risk: RiskVerdict,
  score: number | null
): string[] {
  if (score === null) {
    return [];
  }
  const trendPart =
    trend === "uptrend"
      ? "上昇トレンド（+25）"
      : trend === "downtrend"
        ? "下落トレンド（−25）"
        : "横ばい（±0）";
  const momentumPart =
    momentum === "neutral"
      ? "中立モメンタム（+15）"
      : momentum === "overbought"
        ? "過熱（−15）"
        : "売られ過ぎ（−10）";
  const riskPart =
    risk === "low" ? "低リスク（+10）" : risk === "high" ? "高リスク（−10）" : "標準リスク（±0）";
  return [
    "基準値 50 を起点に算出しています。",
    `トレンド: ${trendPart}`,
    `モメンタム: ${momentumPart}`,
    `リスク: ${riskPart}`,
    `合計（0〜100にクランプ）: ${score}`,
  ];
}

/**
 * Human-readable reasons specific indicators could not be computed. A field is
 * only reported when it is EXPLICITLY null (present but uncomputable) — an
 * `undefined` (field not supplied by a caller) is treated as "not requested" so
 * direct unit callers are not given spurious limitations.
 */
export function computeDataLimitations(metrics: StockMetrics): string[] {
  const reasons: string[] = [];
  const isNull = (v: number | null | undefined): boolean => v === null;
  if (isNull(metrics.rsi14)) {
    reasons.push("RSI(14): 約15営業日分の履歴が必要です。");
  }
  if (isNull(metrics.sma50)) {
    reasons.push("50日移動平均: 50営業日分の履歴が必要です。");
  }
  if (isNull(metrics.macd)) {
    reasons.push("MACD: 約26営業日分の履歴が必要です。");
  } else if (isNull(metrics.macdSignal)) {
    reasons.push("MACDシグナル: シグナル線の算出に約35営業日分の履歴が必要です。");
  }
  if (isNull(metrics.bollingerMiddle)) {
    reasons.push("ボリンジャーバンド: 20営業日分の履歴が必要です。");
  }
  if (isNull(metrics.annualizedVolatilityPercent)) {
    reasons.push("年率ボラティリティ: 3営業日以上の履歴が必要です。");
  }
  return reasons;
}

/** Runs the full rule-based analysis over a metrics snapshot. */
export function analyze(metrics: StockMetrics): StockAnalysis {
  const trend = analyzeTrend(metrics);
  const momentum = analyzeMomentum(metrics);
  const risk = analyzeRisk(metrics);
  const score = computeScore(trend, momentum, risk);

  const comments = [
    trendComment(trend),
    momentumComment(momentum, metrics.rsi14),
    riskComment(risk, metrics.annualizedVolatilityPercent, metrics.maxDrawdownPercent),
  ];

  return {
    trend,
    momentum,
    risk,
    score,
    comments,
    scoreRationale: computeScoreRationale(trend, momentum, risk, score),
    dataLimitations: computeDataLimitations(metrics),
  };
}
