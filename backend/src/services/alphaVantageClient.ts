import {
  advisoryResponseSchema,
  timeSeriesDailyResponseSchema,
} from "../schemas/alphaVantage";
import { ApiError, errorFor } from "../types/errors";
import { isRealIsoDate } from "../utils/dates";
import { DEFAULT_RANGE, type DailyBar, type StockRange, type StockTimeSeries } from "../types/stock";
import { classifyProviderMessage } from "./providerErrorClassifier";

const DEFAULT_BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_TIMEOUT_MS = 8_000;

// Re-export so existing importers (mock provider, service) keep one import site.
export { DEFAULT_RANGE };

/**
 * The wire request is ALWAYS `outputsize=compact` (latest ~100 trading days),
 * regardless of the requested logical window. The client returns the full
 * compact series stamped with `range`; the SERVICE slices it to the window's
 * trailing N bars. We never claim to fetch more history than compact provides.
 */

/**
 * Default hard cap on accepted daily points. `compact` is ~100; this leaves
 * headroom while guarding against an unexpectedly huge response exhausting
 * memory/CPU. Overridable via `ALPHA_VANTAGE_MAX_POINTS`.
 */
export const MAX_SERIES_POINTS = 120;

/**
 * Minimal subset of the global `fetch` contract we depend on. `headers` is
 * optional so tests can supply a trivial stub; when present we use it to reject
 * non-JSON responses before parsing.
 */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json: () => Promise<unknown>;
}>;

export interface AlphaVantageClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-request timeout budget (ms). */
  timeoutMs?: number;
  /** Hard cap on accepted daily points (defaults to {@link MAX_SERIES_POINTS}). */
  maxPoints?: number;
  /** Injectable fetch implementation. Defaults to the global `fetch`. */
  fetchFn?: FetchLike;
}

export interface AlphaVantageClient {
  fetchDailySeries(ticker: string, range?: StockRange): Promise<StockTimeSeries>;
}

function buildUrl(baseUrl: string, ticker: string, apiKey: string): string {
  const params = new URLSearchParams({
    function: "TIME_SERIES_DAILY",
    symbol: ticker,
    outputsize: "compact",
    datatype: "json",
    apikey: apiKey,
  });
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Maps a non-2xx provider status to a public error. Bodies are never read; only
 * a safe `HTTP <status>` tag is attached as (development-only) detail.
 *
 * - 429            -> PROVIDER_RATE_LIMITED
 * - 408 / 504      -> PROVIDER_TIMEOUT
 * - 401 / 403      -> API_KEY_INVALID (auth/forbidden ~ key/entitlement)
 * - 400            -> PROVIDER_RESPONSE_INVALID (malformed request/response)
 * - 500 / 502 / 503 / 404 / other -> PROVIDER_UNAVAILABLE
 *
 * 404 is deliberately mapped to PROVIDER_UNAVAILABLE, not SYMBOL_NOT_FOUND: a
 * missing symbol is reported by Alpha Vantage with HTTP 200 + an advisory body,
 * so we never infer "bad symbol" from an HTTP status alone.
 */
function classifyHttpStatus(status: number): ApiError {
  const detail = `HTTP ${status}`;
  if (status === 429) return errorFor("PROVIDER_RATE_LIMITED", detail);
  if (status === 408 || status === 504) return errorFor("PROVIDER_TIMEOUT", detail);
  if (status === 401 || status === 403) return errorFor("API_KEY_INVALID", detail);
  if (status === 400) return errorFor("PROVIDER_RESPONSE_INVALID", detail);
  return errorFor("PROVIDER_UNAVAILABLE", detail);
}

/** Lowercased content-type (no params), or "" if headers are unavailable. */
function readContentType(response: { headers?: { get(name: string): string | null } }): string {
  try {
    const raw = response.headers?.get?.("content-type") ?? "";
    return typeof raw === "string" ? raw.split(";")[0]!.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Classifies the advisory envelopes Alpha Vantage returns (with HTTP 200) in
 * place of data and throws the matching public error. Each present channel is
 * classified by message CONTENT (see {@link classifyProviderMessage}); the raw
 * provider text is used only for that internal decision and never surfaced.
 */
function throwOnAdvisory(payload: unknown): void {
  const advisory = advisoryResponseSchema.safeParse(payload);
  if (!advisory.success) {
    return;
  }
  const { "Error Message": errorMessage, Note: note, Information: info } = advisory.data;

  if (errorMessage !== undefined) {
    throw errorFor(classifyProviderMessage("errorMessage", errorMessage), "advisory:errorMessage");
  }
  if (note !== undefined) {
    throw errorFor(classifyProviderMessage("note", note), "advisory:note");
  }
  if (info !== undefined) {
    throw errorFor(classifyProviderMessage("information", info), "advisory:information");
  }
}

/**
 * True only for a media type we will parse as JSON: exactly `application/json`
 * or any structured-suffix `+json` type (e.g. `application/problem+json`,
 * `application/vnd.api+json`). Deliberately strict: `application/notjson`,
 * `text/jsonish` and `application/jsonp` are NOT JSON.
 */
function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/**
 * Lightweight guard run BEFORE the full per-row Zod parse: bounds the work done
 * on an unexpectedly huge or malformed payload. Only inspects the shape and key
 * count of `Time Series (Daily)` — it never reads bar values or logs the body.
 */
function preCheckSeriesSize(payload: unknown, maxPoints: number): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return; // not an object: the full schema reports the shape error.
  }
  const timeSeries = (payload as Record<string, unknown>)["Time Series (Daily)"];
  if (timeSeries === undefined) {
    return; // advisory or missing series: handled downstream.
  }
  if (typeof timeSeries !== "object" || timeSeries === null || Array.isArray(timeSeries)) {
    throw errorFor("PROVIDER_RESPONSE_INVALID", "timeseries-shape");
  }
  if (Object.keys(timeSeries).length > maxPoints) {
    // Reject up front — never slice/truncate silently — so we don't deep-parse a
    // huge object.
    throw errorFor("PROVIDER_RESPONSE_INVALID", "too-many-points");
  }
}

/**
 * Cross-field validates and normalizes a parsed success payload into a clean,
 * ascending `StockTimeSeries`. Any structural violation is a
 * `PROVIDER_RESPONSE_INVALID`; an empty series is `INSUFFICIENT_DATA`.
 *
 * Policy: a single inconsistent row rejects the WHOLE payload rather than being
 * silently dropped. Dropping rows would corrupt period return / drawdown / RSI
 * and present provider anomalies as valid analysis — unacceptable for a public
 * analysis tool, so we fail loud and safe instead of silently "fixing" data.
 */
function normalize(
  ticker: string,
  range: StockRange,
  maxPoints: number,
  data: ReturnType<typeof timeSeriesDailyResponseSchema.parse>
): StockTimeSeries {
  const meta = data["Meta Data"];
  const series = data["Time Series (Daily)"];
  const warnings: string[] = [];

  // Meta integrity: the returned symbol must match what we asked for.
  if (meta["2. Symbol"].trim().toUpperCase() !== ticker.trim().toUpperCase()) {
    throw errorFor("PROVIDER_RESPONSE_INVALID", "symbol-mismatch");
  }

  const entries = Object.entries(series);
  if (entries.length > maxPoints) {
    throw errorFor("PROVIDER_RESPONSE_INVALID", "too-many-points");
  }

  const byDate = new Map<string, DailyBar>();
  let duplicates = 0;

  for (const [date, bar] of entries) {
    if (!isRealIsoDate(date)) {
      throw errorFor("PROVIDER_RESPONSE_INVALID", "invalid-date");
    }

    const open = bar["1. open"];
    const high = bar["2. high"];
    const low = bar["3. low"];
    const close = bar["4. close"];
    const volume = bar["5. volume"];

    // Prices are already finite/positive (schema); enforce OHLC consistency.
    if (high < low || high < open || high < close || low > open || low > close) {
      throw errorFor("PROVIDER_RESPONSE_INVALID", "ohlc-inconsistent");
    }

    // Volume must be a non-negative SAFE integer (no fractions / overflow / NaN).
    if (!Number.isSafeInteger(volume) || volume < 0) {
      throw errorFor("PROVIDER_RESPONSE_INVALID", "invalid-volume");
    }

    if (byDate.has(date)) {
      duplicates += 1;
    }
    // Keep the last occurrence for a duplicated date.
    byDate.set(date, { date, open, high, low, close, adjustedClose: null, volume });
  }

  if (duplicates > 0) {
    warnings.push(`重複した日付が${duplicates}件あったため、最新の値を採用しました。`);
  }

  const bars = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  if (bars.length === 0) {
    throw errorFor("INSUFFICIENT_DATA", "empty-series");
  }

  return {
    ticker,
    range,
    currency: null, // TIME_SERIES_DAILY does not report currency.
    timezone: meta["5. Time Zone"] ?? null,
    lastRefreshed: meta["3. Last Refreshed"] ?? null,
    priceBasis: "close",
    bars,
    warnings,
  };
}

/**
 * Creates an Alpha Vantage client for daily time series. The returned function
 * never throws raw network/parse errors at callers — everything is normalized
 * into the unified `ApiError` contract, and the API key / raw provider body are
 * never exposed.
 */
export function createAlphaVantageClient(
  options: AlphaVantageClientOptions
): AlphaVantageClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPoints = Math.max(1, Math.floor(options.maxPoints ?? MAX_SERIES_POINTS));
  const fetchFn = options.fetchFn ?? (globalThis.fetch as FetchLike | undefined);

  if (typeof fetchFn !== "function") {
    throw new Error("No fetch implementation available (Node >= 20.19 required).");
  }

  return {
    async fetchDailySeries(ticker: string, range: StockRange = DEFAULT_RANGE): Promise<StockTimeSeries> {
      const url = buildUrl(baseUrl, ticker, options.apiKey);

      // Real AbortController + timer (not AbortSignal.timeout) so the timer is
      // observable and cancellable in tests, and we can guarantee cleanup.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // 1. Transport.
        let response: Awaited<ReturnType<FetchLike>>;
        try {
          response = await fetchFn(url, { signal: controller.signal });
        } catch {
          if (controller.signal.aborted) {
            throw errorFor("PROVIDER_TIMEOUT");
          }
          throw errorFor("PROVIDER_UNAVAILABLE");
        }

        // 2. HTTP status.
        if (!response.ok) {
          throw classifyHttpStatus(response.status);
        }

        // 3. Content-Type guard. Only `application/json` (or a `+json` suffix
        // type) is parsed; a non-JSON 200 (HTML/text proxy or maintenance page,
        // or look-alikes like `application/notjson`) is rejected without
        // parsing. Only the safe mime type — not the body — is attached as
        // detail. A MISSING content-type is allowed through to JSON parsing
        // because Alpha Vantage sometimes omits the header on valid responses.
        const contentType = readContentType(response);
        if (contentType && !isJsonMediaType(contentType)) {
          throw errorFor("PROVIDER_RESPONSE_INVALID", `content-type:${contentType}`);
        }

        // 4. JSON parse (non-JSON / HTML pages / empty body reject here).
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw errorFor("PROVIDER_RESPONSE_INVALID", "json-parse");
        }

        // 5. Advisory (error / rate-limit) envelopes.
        throwOnAdvisory(payload);

        // 6. Early size/shape guard BEFORE the heavy per-row Zod parse, so an
        // oversized or malformed series cannot force deep validation of every row.
        preCheckSeriesSize(payload, maxPoints);

        // 7. Success-shape schema.
        const parsed = timeSeriesDailyResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw errorFor(
            "PROVIDER_RESPONSE_INVALID",
            parsed.error.issues.map((issue) => issue.message)
          );
        }

        // 8. Cross-field validation + normalization.
        return normalize(ticker, range, maxPoints, parsed.data);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
