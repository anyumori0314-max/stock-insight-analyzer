import { z } from "zod";

/**
 * Schemas for the raw Alpha Vantage `TIME_SERIES_DAILY` (JSON) response.
 *
 * Alpha Vantage returns every number as a string and uses human-readable,
 * space-and-digit-prefixed keys ("1. open", "Time Series (Daily)"). These
 * schemas validate that wire format and coerce the strings into numbers so the
 * rest of the backend only ever deals with the clean `StockTimeSeries` shape.
 *
 * IMPORTANT: Alpha Vantage signals problems with HTTP 200 + a JSON body that
 * carries one of `Error Message` / `Note` / `Information` instead of a time
 * series. Those are detected in the client BEFORE this schema runs, so the
 * schemas below only describe the success payload.
 */

/**
 * Strict numeric string from the provider. Unlike `z.coerce.number()` — which
 * silently turns "", "   ", null, true and [] into 0/1 — this accepts ONLY a
 * finite number or a non-empty numeric string. Surrounding whitespace is
 * trimmed (provider quirk tolerance), but the trimmed content must be a pure
 * numeric literal (so "123abc" is rejected, not partially parsed).
 */
const NUMERIC_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function providerNumber(opts: { positive?: boolean; integer?: boolean }) {
  return z.unknown().transform((value, ctx): number => {
    let num: number;
    if (typeof value === "number") {
      num = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "" || !NUMERIC_STRING.test(trimmed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a numeric string" });
        return z.NEVER;
      }
      num = Number(trimmed);
    } else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a number or numeric string" });
      return z.NEVER;
    }
    // Rejects NaN, ±Infinity and overflow (e.g. "1e309" -> Infinity).
    if (!Number.isFinite(num)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a finite number" });
      return z.NEVER;
    }
    if (opts.positive ? !(num > 0) : num < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: opts.positive ? "Expected a positive number" : "Expected a non-negative number",
      });
      return z.NEVER;
    }
    if (opts.integer && !Number.isSafeInteger(num)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a safe integer" });
      return z.NEVER;
    }
    return num;
  });
}

/** A positive, finite price. */
const priceString = providerNumber({ positive: true });
/** Volume: a non-negative SAFE integer (0 is legitimate on holidays/halts). */
const volumeString = providerNumber({ integer: true });

export const rawDailyBarSchema = z.object({
  "1. open": priceString,
  "2. high": priceString,
  "3. low": priceString,
  "4. close": priceString,
  "5. volume": volumeString,
});

export const metaDataSchema = z.object({
  "2. Symbol": z.string().min(1),
  "3. Last Refreshed": z.string().min(1),
  "5. Time Zone": z.string().min(1),
});

export const timeSeriesDailyResponseSchema = z.object({
  "Meta Data": metaDataSchema,
  // Date string -> bar. May be empty: an empty-but-well-formed series is a
  // data condition (INSUFFICIENT_DATA), handled during normalization, not a
  // malformed response.
  "Time Series (Daily)": z.record(z.string(), rawDailyBarSchema),
});

export type RawDailyBar = z.infer<typeof rawDailyBarSchema>;
export type TimeSeriesDailyResponse = z.infer<typeof timeSeriesDailyResponseSchema>;

/**
 * Shape of the informational/error envelopes Alpha Vantage returns (with HTTP
 * 200). We read these keys defensively before attempting success-schema
 * validation. All are optional because only one is present at a time.
 */
export const advisoryResponseSchema = z.object({
  "Error Message": z.string().optional(),
  Note: z.string().optional(),
  Information: z.string().optional(),
});
