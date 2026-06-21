import { z } from "zod";

/**
 * Runtime validation of the backend `StockReport` contract. The frontend NEVER
 * casts `response.json()` straight to `StockReport`; it parses through this
 * schema so a malformed payload becomes a safe UI error instead of corrupt
 * state. Mirrors `backend/src/schemas/report.ts`.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const finite = z.number().refine((value) => Number.isFinite(value), {
  message: "Expected a finite number",
});
const finiteOrNull = finite.nullable();

export const trendVerdictSchema = z.enum(["uptrend", "downtrend", "sideways", "unknown"]);
export const momentumVerdictSchema = z.enum(["overbought", "oversold", "neutral", "unknown"]);
export const riskVerdictSchema = z.enum(["low", "medium", "high", "unknown"]);

export const stockPricePointSchema = z.object({
  date: z.string().regex(ISO_DATE),
  open: finite,
  high: finite,
  low: finite,
  close: finite,
  adjustedClose: finiteOrNull,
  volume: finite,
  sma20: finiteOrNull,
  sma50: finiteOrNull,
});

export const stockMetricsSchema = z.object({
  currentPrice: finite,
  dailyChange: finiteOrNull,
  dailyChangePercent: finiteOrNull,
  periodReturnPercent: finiteOrNull,
  sma20: finiteOrNull,
  sma50: finiteOrNull,
  rsi14: finiteOrNull,
  annualizedVolatilityPercent: finiteOrNull,
  maxDrawdownPercent: finiteOrNull,
});

export const stockAnalysisSchema = z.object({
  trend: trendVerdictSchema,
  momentum: momentumVerdictSchema,
  risk: riskVerdictSchema,
  score: z.number().int().min(0).max(100).nullable(),
  comments: z.array(z.string()),
});

export const cacheMetadataSchema = z.object({
  hit: z.boolean(),
  expiresAt: z.string().nullable(),
});

export const stockReportSchema = z.object({
  ticker: z.string().min(1),
  range: z.string().min(1),
  currency: z.string().nullable(),
  timezone: z.string().nullable(),
  lastRefreshed: z.string().nullable(),
  priceBasis: z.enum(["close", "adjusted"]),
  series: z.array(stockPricePointSchema),
  metrics: stockMetricsSchema,
  analysis: stockAnalysisSchema,
  warnings: z.array(z.string()),
  cache: cacheMetadataSchema,
  disclaimer: z.string().min(1),
});
