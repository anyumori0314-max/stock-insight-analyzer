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

/** A positive, finite price coerced from the provider's string value. */
const priceString = z.coerce.number().finite().positive();
/** Volume can legitimately be 0 (e.g. holidays/halts), so allow non-negative. */
const volumeString = z.coerce.number().finite().nonnegative();

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
