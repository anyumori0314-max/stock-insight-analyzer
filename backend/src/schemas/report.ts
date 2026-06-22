import { z } from "zod";

import { isRealIsoDate, isRealIsoDateTimeUtc, isRealProviderTimestamp } from "../utils/dates";

/**
 * zod schema for the public `StockReport` contract. Used both in tests and — at
 * runtime, right before the response is sent — to assert that what we serialize
 * is EXACTLY the documented shape: every numeric field finite (never NaN/Infinity
 * that `JSON.stringify` would silently turn into `null`), every date/time a real
 * calendar value, and NO unknown fields (`.strict()`), so an internal field can
 * never leak into an HTTP response.
 */

/** A finite number (rejects NaN / ±Infinity). */
const finite = z.number().refine((value) => Number.isFinite(value), {
  message: "Expected a finite number",
});
const finiteOrNull = finite.nullable();

/** A real `YYYY-MM-DD` calendar date (rejects e.g. 2026-02-30). */
const realIsoDate = z.string().refine(isRealIsoDate, { message: "Expected a real ISO date" });
/** A real ISO 8601 UTC instant (rejects e.g. 2026-99-99T99:99:99Z). */
const realIsoDateTime = z
  .string()
  .refine(isRealIsoDateTimeUtc, { message: "Expected a real ISO 8601 UTC datetime" });
/** A real provider timestamp: `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`. */
const realProviderTimestamp = z
  .string()
  .refine(isRealProviderTimestamp, { message: "Expected a real provider timestamp" });

export const trendVerdictSchema = z.enum(["uptrend", "downtrend", "sideways", "unknown"]);
export const momentumVerdictSchema = z.enum(["overbought", "oversold", "neutral", "unknown"]);
export const riskVerdictSchema = z.enum(["low", "medium", "high", "unknown"]);

export const stockPricePointSchema = z
  .object({
    date: realIsoDate,
    open: finite,
    high: finite,
    low: finite,
    close: finite,
    adjustedClose: finiteOrNull,
    volume: finite,
    sma20: finiteOrNull,
    sma50: finiteOrNull,
  })
  .strict();

export const stockMetricsSchema = z
  .object({
    currentPrice: finite,
    dailyChange: finiteOrNull,
    dailyChangePercent: finiteOrNull,
    periodReturnPercent: finiteOrNull,
    sma20: finiteOrNull,
    sma50: finiteOrNull,
    rsi14: finiteOrNull,
    annualizedVolatilityPercent: finiteOrNull,
    maxDrawdownPercent: finiteOrNull,
  })
  .strict();

export const stockAnalysisSchema = z
  .object({
    trend: trendVerdictSchema,
    momentum: momentumVerdictSchema,
    risk: riskVerdictSchema,
    score: z.number().int().min(0).max(100).nullable(),
    comments: z.array(z.string()),
  })
  .strict();

export const cacheMetadataSchema = z
  .object({
    hit: z.boolean(),
    // A real ISO 8601 UTC instant or null; rejects malformed/impossible timestamps.
    expiresAt: realIsoDateTime.nullable(),
  })
  .strict();

export const stockReportSchema = z
  .object({
    ticker: z.string().min(1),
    // Required (no default): a missing source must FAIL validation, never be
    // silently assumed. The service always stamps "live" or "mock".
    source: z.enum(["live", "mock"]),
    // One of the supported analysis windows (compact feed backs only 1m / 3m).
    range: z.enum(["1m", "3m"]),
    currency: z.string().nullable(),
    timezone: z.string().nullable(),
    lastRefreshed: realProviderTimestamp.nullable(),
    priceBasis: z.enum(["close", "adjusted"]),
    series: z.array(stockPricePointSchema),
    metrics: stockMetricsSchema,
    analysis: stockAnalysisSchema,
    warnings: z.array(z.string()),
    cache: cacheMetadataSchema,
    disclaimer: z.string().min(1),
  })
  // No unknown fields: an internal/debug field can never leak into a response.
  .strict();

export type StockReportContract = z.infer<typeof stockReportSchema>;
