import { z } from "zod";

import { isRealIsoDate, isRealIsoDateTimeUtc, isRealProviderTimestamp } from "./dates";

/**
 * Runtime validation of the backend `StockReport` contract. The frontend NEVER
 * casts `response.json()` straight to `StockReport`; it parses through this
 * schema so a malformed payload becomes a safe UI error instead of corrupt
 * state. Mirrors `backend/src/schemas/report.ts` — including `.strict()` (no
 * unknown fields), a required `source`, the supported range enum, and
 * real-calendar date/time validation.
 */

const finite = z.number().refine((value) => Number.isFinite(value), {
  message: "Expected a finite number",
});
const finiteOrNull = finite.nullable();

const realIsoDate = z.string().refine(isRealIsoDate, { message: "Expected a real ISO date" });
const realIsoDateTime = z
  .string()
  .refine(isRealIsoDateTimeUtc, { message: "Expected a real ISO 8601 UTC datetime" });
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

/**
 * Safe data-provenance / freshness metadata (Phase 15). MUST mirror
 * `backend/src/schemas/report.ts` exactly (strict, same fields, same nullability).
 */
export const dataStatusSchema = z
  .object({
    dataMode: z.enum(["live", "mock", "historical", "hybrid"]),
    dataSource: z.enum(["mock", "sqlite", "csv", "api"]),
    latestTradeDate: realIsoDate.nullable(),
    lastUpdatedAt: realIsoDateTime.nullable(),
    csvImportedAt: realIsoDateTime.nullable(),
    apiSyncedAt: realIsoDateTime.nullable(),
    persistent: z.boolean(),
    stale: z.boolean(),
    fallbackUsed: z.boolean(),
    recordCount: z.number().int().min(0),
  })
  .strict();

export const stockReportSchema = z
  .object({
    ticker: z.string().min(1),
    // Required (no default): a missing source is a contract violation. Mirrors the
    // backend's four data-serving modes.
    source: z.enum(["live", "mock", "historical", "hybrid"]),
    // One of the supported analysis windows (mirrors the backend enum:
    // compact feed backs only 1m / 3m).
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
    // Optional so existing fixtures and the Phase 2–11 contract stay valid.
    dataStatus: dataStatusSchema.optional(),
    disclaimer: z.string().min(1),
  })
  .strict();
