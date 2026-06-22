/**
 * The analyzed payload returned by `GET /api/stock/:ticker`.
 *
 * This is the public API contract, mirrored on the frontend and validated at
 * both ends with a zod schema (`schemas/report.ts`). It bundles the chartable
 * series, headline metrics, a rule-based (explicitly non-advisory) analysis,
 * cache metadata, and any non-fatal warnings.
 */

import type { StockRange } from "./stock";

export type TrendVerdict = "uptrend" | "downtrend" | "sideways" | "unknown";
export type MomentumVerdict = "overbought" | "oversold" | "neutral" | "unknown";
export type RiskVerdict = "low" | "medium" | "high" | "unknown";

/** A chartable point: raw OHLCV (+ adjusted close) plus aligned moving averages. */
export interface StockPricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Always null for the free `TIME_SERIES_DAILY` endpoint (raw close basis). */
  adjustedClose: number | null;
  volume: number;
  sma20: number | null;
  sma50: number | null;
}

/** Headline indicators for the latest trading day. `null` = not computable. */
export interface StockMetrics {
  /** Latest close. A returned report always has at least one bar. */
  currentPrice: number;
  /** Last close minus the prior close. null if < 2 bars or prior is 0. */
  dailyChange: number | null;
  dailyChangePercent: number | null;
  /** Return from the first to the last close in the window, in percent. */
  periodReturnPercent: number | null;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  annualizedVolatilityPercent: number | null;
  /** Largest peak-to-trough decline, as a non-positive percent. */
  maxDrawdownPercent: number | null;
}

export interface StockAnalysis {
  trend: TrendVerdict;
  momentum: MomentumVerdict;
  risk: RiskVerdict;
  /**
   * Composite 0–100 "technical state" reference value (NOT a buy/sell score).
   * `null` when any dimension is unknown (too little data).
   */
  score: number | null;
  /** Descriptive, non-advisory commentary (Japanese). */
  comments: string[];
}

export interface CacheMetadata {
  /** True when this response was served from the in-memory cache. */
  hit: boolean;
  /** ISO timestamp when the cached entry expires, or null if not cached. */
  expiresAt: string | null;
}

export interface StockReport {
  ticker: string;
  /**
   * Which provider produced this report: "live" (Alpha Vantage) or "mock"
   * (deterministic in-process fixtures). The service stamps it; the UI shows a
   * notice for "mock" so development data is never mistaken for real prices.
   */
  source: "live" | "mock";
  /** Logical window identifier (`1m` / `3m`). */
  range: StockRange;
  /** Reporting currency if known; null for `TIME_SERIES_DAILY`. */
  currency: string | null;
  timezone: string | null;
  lastRefreshed: string | null;
  /** Raw close basis (no split/dividend adjustment) for the free endpoint. */
  priceBasis: "close" | "adjusted";
  series: StockPricePoint[];
  metrics: StockMetrics;
  analysis: StockAnalysis;
  /** Non-fatal notes (e.g. limited history, dropped duplicate dates). */
  warnings: string[];
  cache: CacheMetadata;
  /** Always-present reminder that this is information, not investment advice. */
  disclaimer: string;
}
