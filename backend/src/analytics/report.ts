import type { StockMetrics, StockPricePoint, StockReport } from "../types/report";
import type { StockTimeSeries } from "../types/stock";
import { analyze } from "./analysis";
import {
  annualizedVolatilityPct,
  bollingerBands,
  dailyChange,
  dailyChangePercent,
  macd,
  maxDrawdownPct,
  movingAverageDeviationPct,
  periodReturnPct,
  rsi,
  sma,
  smaSeries,
  volumeChangePct,
} from "./indicators";

/**
 * Single, canonical disclaimer. Surfaced verbatim in the API payload and echoed
 * (in a readable layout) in the UI footer so the product is never read as
 * investment advice. Kept in sync with the README disclaimer section.
 */
export const DISCLAIMER =
  "本ツールが提供する情報は、過去の公開株価データに基づく参考情報であり、投資助言や特定銘柄の売買推奨ではありません。" +
  "データの正確性・完全性・即時性を保証するものではなく、外部データ提供元の遅延・停止・利用制限が生じる場合があります。" +
  "価格は分割・配当調整前の終値（raw close）を用いています。過去の実績は将来の成果を保証しません。" +
  "投資に関する最終的な判断は、利用者ご自身の責任で行ってください。";

const SMA_SHORT = 20;
const SMA_LONG = 50;

/**
 * Assembles the public `StockReport` from a normalized time series: chartable
 * points (OHLCV + aligned moving averages), headline metrics (all finite or
 * null), the rule-based analysis, and any non-fatal warnings. Pure and
 * synchronous. `cache` is a placeholder here — the service fills it in based on
 * hit/miss before responding.
 */
export function buildStockReport(series: StockTimeSeries): StockReport {
  const closes = series.bars.map((bar) => bar.close);
  const sma20Series = smaSeries(closes, SMA_SHORT);
  const sma50Series = smaSeries(closes, SMA_LONG);

  const points: StockPricePoint[] = series.bars.map((bar, index) => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    adjustedClose: bar.adjustedClose,
    volume: bar.volume,
    sma20: sma20Series[index],
    sma50: sma50Series[index],
  }));

  // A normalized series always has >= 1 bar (else the client throws
  // INSUFFICIENT_DATA), so the latest close is a real finite number.
  const currentPrice = closes[closes.length - 1];
  const volumes = series.bars.map((bar) => bar.volume);
  const macdResult = macd(closes);
  const bands = bollingerBands(closes);

  const metrics: StockMetrics = {
    currentPrice,
    dailyChange: dailyChange(closes),
    dailyChangePercent: dailyChangePercent(closes),
    periodReturnPercent: periodReturnPct(closes),
    sma20: sma(closes, SMA_SHORT),
    sma50: sma(closes, SMA_LONG),
    rsi14: rsi(closes),
    annualizedVolatilityPercent: annualizedVolatilityPct(closes),
    maxDrawdownPercent: maxDrawdownPct(closes),
    // Phase 20 extended indicators.
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    bollingerUpper: bands.upper,
    bollingerMiddle: bands.middle,
    bollingerLower: bands.lower,
    volumeChangePercent: volumeChangePct(volumes),
    sma20DeviationPercent: movingAverageDeviationPct(closes, SMA_SHORT),
    sma50DeviationPercent: movingAverageDeviationPct(closes, SMA_LONG),
  };

  const warnings = [...series.warnings];
  if (series.bars.length < SMA_LONG) {
    warnings.push(
      `利用可能な履歴が${series.bars.length}日分のため、一部の指標（50日移動平均など）は算出できない場合があります。`
    );
  }
  // De-duplicate while preserving first-seen order so the public `warnings`
  // array is deterministic and never repeats the same note.
  const dedupedWarnings = [...new Set(warnings)];

  return {
    ticker: series.ticker,
    // Placeholder; the service overwrites it with the active data mode (like
    // `cache`). buildStockReport is pure and provider-agnostic.
    source: "live",
    range: series.range,
    currency: series.currency,
    timezone: series.timezone,
    lastRefreshed: series.lastRefreshed,
    priceBasis: series.priceBasis,
    series: points,
    metrics,
    analysis: analyze(metrics),
    warnings: dedupedWarnings,
    cache: { hit: false, expiresAt: null },
    disclaimer: DISCLAIMER,
  };
}
