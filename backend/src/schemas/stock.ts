import { z } from "zod";

import { DEFAULT_RANGE, STOCK_RANGES } from "../types/stock";

/**
 * Maximum accepted length (after trimming). Guards against oversized input
 * before any further processing. Real US tickers are short; class-share
 * suffixes (e.g. BRK.B) stay well within this bound.
 */
const MAX_TICKER_LENGTH = 10;

/**
 * Allowed ticker shape, validated on the *pre-uppercase* (trimmed) value:
 *   - 1+ ASCII alphanumerics, with optional `.`/`-` separators that must each
 *     be followed by more alphanumerics (covers class shares like BRK.B, BF.A,
 *     BRK-B). Total length is bounded by MAX_TICKER_LENGTH.
 *   - The character class is ASCII-only by construction, so non-ASCII look-
 *     alikes that could fold to ASCII when uppercased (e.g. `ſ` -> S, `ı` -> I,
 *     full-width forms) are rejected *before* normalization.
 *   - Leading/trailing/consecutive separators, `..`, slashes, spaces and
 *     control characters are all rejected, so path-traversal / injection-style
 *     input never passes.
 *
 * NOTE: slash-bearing symbols such as `RDS/A` are intentionally NOT accepted in
 * Phase 1; they are deferred until the Alpha Vantage provider format is
 * confirmed in Phase 2.
 */
const TICKER_PATTERN = /^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/;

export const tickerSchema = z
  .string()
  .trim()
  .min(1, "Ticker must not be empty.")
  .max(MAX_TICKER_LENGTH, `Ticker must be at most ${MAX_TICKER_LENGTH} characters.`)
  // Regex runs on the trimmed, pre-uppercase value (ASCII-only allow-list)...
  .regex(TICKER_PATTERN, "Ticker contains invalid characters.")
  // ...and only then do we normalize to uppercase.
  .transform((value) => value.toUpperCase());

export type Ticker = z.infer<typeof tickerSchema>;

/**
 * Validates the optional `?range=` query parameter. A missing value defaults to
 * the standard window; anything other than a supported window (including a
 * repeated/array param) is rejected as `INVALID_RANGE` — we never accept a
 * range we cannot actually serve.
 */
export const rangeQuerySchema = z.preprocess(
  (value) => (value === undefined || value === null ? DEFAULT_RANGE : value),
  z.enum(STOCK_RANGES)
);

export type RangeQuery = z.infer<typeof rangeQuerySchema>;
