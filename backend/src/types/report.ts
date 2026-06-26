/**
 * The analyzed payload returned by `GET /api/stock/:ticker`.
 *
 * This is the public API contract, mirrored on the frontend and validated at
 * both ends with a zod schema (`schemas/report.ts`). It bundles the chartable
 * series, headline metrics, a rule-based (explicitly non-advisory) analysis,
 * cache metadata, and any non-fatal warnings.
 */

import type { DataSourceMetadata } from "../domain/historical";
import type { StockDataMode, StockRange } from "./stock";

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
  // --- Phase 20: extended indicators. OPTIONAL so the Phase 2–11 contract and
  // existing fixtures stay valid; the report builder always populates them. ----
  /** MACD line (fast EMA − slow EMA). */
  macd?: number | null;
  /** MACD signal line (EMA of the MACD line). */
  macdSignal?: number | null;
  /** MACD histogram (MACD − signal). */
  macdHistogram?: number | null;
  /** Bollinger upper band (SMA20 + 2σ). */
  bollingerUpper?: number | null;
  /** Bollinger middle band (SMA20). */
  bollingerMiddle?: number | null;
  /** Bollinger lower band (SMA20 − 2σ). */
  bollingerLower?: number | null;
  /** Day-over-day trading volume change, in percent. */
  volumeChangePercent?: number | null;
  /** Deviation of the latest close from SMA20, in percent. */
  sma20DeviationPercent?: number | null;
  /** Deviation of the latest close from SMA50, in percent. */
  sma50DeviationPercent?: number | null;
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
  // --- Phase 20: explainability. OPTIONAL so existing fixtures stay valid. -----
  /**
   * Per-factor rationale for the composite score: which signals pushed it up or
   * down. Empty when the score is null (too little data). Descriptive, never
   * advisory.
   */
  scoreRationale?: string[];
  /**
   * Reasons specific indicators / the score could not be computed (e.g. the
   * window is too short for SMA50 or the MACD signal line). Lets the UI explain
   * a "—" instead of silently hiding it.
   */
  dataLimitations?: string[];
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
   * The data-serving mode that produced this report: "live", "mock",
   * "historical" or "hybrid". The service stamps it; the UI shows a notice for
   * non-live sources so development / stored data is never mistaken for fresh
   * real-time prices. (The finer-grained origin is in {@link dataStatus}.)
   */
  source: StockDataMode;
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
  /**
   * Safe data-provenance / freshness metadata (Phase 15). OPTIONAL so existing
   * fixtures and the Phase 2–11 contract remain valid; the service populates it
   * for every served report. Contains NO internal paths, stacks or API-key state.
   */
  dataStatus?: DataSourceMetadata;
  /** Always-present reminder that this is information, not investment advice. */
  disclaimer: string;
}
