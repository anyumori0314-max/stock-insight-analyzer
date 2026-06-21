import {
  advisoryResponseSchema,
  timeSeriesDailyResponseSchema,
} from "../schemas/alphaVantage";
import { ApiError, type ErrorCode } from "../types/errors";
import type { DailyBar, StockTimeSeries } from "../types/stock";

const DEFAULT_BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_TIMEOUT_MS = 8_000;

/** Logical default window. Compact daily ~= the latest 100 trading days. */
export const DEFAULT_RANGE = "100d";

/**
 * Hard cap on the number of daily points we will accept/process. `compact` is
 * ~100 points; this leaves generous headroom while guarding against an
 * unexpectedly huge response exhausting memory/CPU.
 */
export const MAX_SERIES_POINTS = 400;

/**
 * Minimal subset of the global `fetch` contract we depend on. Declaring it
 * explicitly keeps the client trivially mockable in tests — no DOM `Response`
 * instance required.
 */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface AlphaVantageClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-request timeout budget (ms). */
  timeoutMs?: number;
  /** Injectable fetch implementation. Defaults to the global `fetch`. */
  fetchFn?: FetchLike;
}

export interface AlphaVantageClient {
  fetchDailySeries(ticker: string, range?: string): Promise<StockTimeSeries>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function apiError(status: number, code: ErrorCode, message: string, details?: unknown): ApiError {
  return new ApiError(status, code, message, details);
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

/** Maps a non-2xx provider status to a public error. Bodies are never read. */
function classifyHttpStatus(status: number): ApiError {
  if (status === 429) {
    return apiError(
      429,
      "PROVIDER_RATE_LIMITED",
      "The market data provider's rate limit was reached. Please try again later.",
      `HTTP ${status}`
    );
  }
  if (status === 401 || status === 403) {
    return apiError(
      401,
      "API_KEY_INVALID",
      "The market data provider rejected the API key.",
      `HTTP ${status}`
    );
  }
  if (status === 408 || status === 504) {
    return apiError(
      504,
      "PROVIDER_TIMEOUT",
      "The market data provider did not respond in time. Please try again.",
      `HTTP ${status}`
    );
  }
  return apiError(
    502,
    "PROVIDER_UNAVAILABLE",
    "The market data provider is currently unavailable. Please try again later.",
    `HTTP ${status}`
  );
}

/**
 * Classifies the advisory envelopes Alpha Vantage returns (with HTTP 200) in
 * place of data and throws the matching public error. Each key is parsed on its
 * own — we do NOT blanket-map every `Information` to a rate limit.
 */
function throwOnAdvisory(payload: unknown, ticker: string): void {
  const advisory = advisoryResponseSchema.safeParse(payload);
  if (!advisory.success) {
    return;
  }
  const { "Error Message": errorMessage, Note: note, Information: info } = advisory.data;

  if (errorMessage) {
    if (/api[\s-]?key/i.test(errorMessage)) {
      throw apiError(401, "API_KEY_INVALID", "The market data provider rejected the API key.", errorMessage);
    }
    throw apiError(404, "SYMBOL_NOT_FOUND", `No data is available for ticker "${ticker}".`, errorMessage);
  }

  // `Note` is Alpha Vantage's classic per-minute throttle message.
  if (note) {
    throw apiError(
      429,
      "PROVIDER_RATE_LIMITED",
      "The market data provider's rate limit was reached. Please try again later.",
      note
    );
  }

  if (info) {
    if (/rate limit|requests per (day|minute)|premium|subscribe|higher api call|thank you for using/i.test(info)) {
      throw apiError(
        429,
        "PROVIDER_RATE_LIMITED",
        "The market data provider's rate limit was reached. Please try again later.",
        info
      );
    }
    if (/api[\s-]?key/i.test(info)) {
      throw apiError(401, "API_KEY_INVALID", "The market data provider rejected the API key.", info);
    }
    throw apiError(
      502,
      "PROVIDER_UNAVAILABLE",
      "The market data provider returned an unexpected response.",
      info
    );
  }
}

/** True only for an ISO `YYYY-MM-DD` string that denotes a real calendar day. */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/**
 * Cross-field validates and normalizes a parsed success payload into a clean,
 * ascending `StockTimeSeries`. Any structural violation is a
 * `PROVIDER_RESPONSE_INVALID`; an empty series is `INSUFFICIENT_DATA`.
 */
function normalize(
  ticker: string,
  range: string,
  data: ReturnType<typeof timeSeriesDailyResponseSchema.parse>
): StockTimeSeries {
  const meta = data["Meta Data"];
  const series = data["Time Series (Daily)"];
  const warnings: string[] = [];

  // Meta integrity: the returned symbol must match what we asked for.
  if (meta["2. Symbol"].toUpperCase() !== ticker.toUpperCase()) {
    throw apiError(
      502,
      "PROVIDER_RESPONSE_INVALID",
      "The market data provider returned data for a different symbol."
    );
  }

  const entries = Object.entries(series);
  if (entries.length > MAX_SERIES_POINTS) {
    throw apiError(
      502,
      "PROVIDER_RESPONSE_INVALID",
      "The market data provider returned more data than expected."
    );
  }

  const byDate = new Map<string, DailyBar>();
  let duplicates = 0;

  for (const [date, bar] of entries) {
    if (!isRealIsoDate(date)) {
      throw apiError(
        502,
        "PROVIDER_RESPONSE_INVALID",
        "The market data provider returned an invalid date."
      );
    }

    const open = bar["1. open"];
    const high = bar["2. high"];
    const low = bar["3. low"];
    const close = bar["4. close"];
    const volume = bar["5. volume"];

    // Prices are already finite/positive (schema); enforce OHLC consistency.
    if (
      high < low ||
      high < open ||
      high < close ||
      low > open ||
      low > close
    ) {
      throw apiError(
        502,
        "PROVIDER_RESPONSE_INVALID",
        "The market data provider returned inconsistent OHLC values."
      );
    }

    // Volume must be a non-negative, safe integer (no fractions / overflow).
    if (!Number.isInteger(volume) || volume < 0 || volume > Number.MAX_SAFE_INTEGER) {
      throw apiError(
        502,
        "PROVIDER_RESPONSE_INVALID",
        "The market data provider returned an invalid volume."
      );
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
    throw apiError(
      422,
      "INSUFFICIENT_DATA",
      `Not enough data is available for ticker "${ticker}".`
    );
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
  const fetchFn = options.fetchFn ?? (globalThis.fetch as FetchLike | undefined);

  if (typeof fetchFn !== "function") {
    throw new Error("No fetch implementation available (Node >= 20.19 required).");
  }

  return {
    async fetchDailySeries(ticker: string, range: string = DEFAULT_RANGE): Promise<StockTimeSeries> {
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
            throw apiError(
              504,
              "PROVIDER_TIMEOUT",
              "The market data provider did not respond in time. Please try again."
            );
          }
          throw apiError(
            502,
            "PROVIDER_UNAVAILABLE",
            "The market data provider is currently unavailable. Please try again later."
          );
        }

        // 2. HTTP status.
        if (!response.ok) {
          throw classifyHttpStatus(response.status);
        }

        // 3. JSON parse (non-JSON / HTML pages reject here).
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw apiError(
            502,
            "PROVIDER_RESPONSE_INVALID",
            "The market data provider returned an unreadable (non-JSON) response."
          );
        }

        // 4. Advisory (error / rate-limit) envelopes.
        throwOnAdvisory(payload, ticker);

        // 5. Success-shape schema.
        const parsed = timeSeriesDailyResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw apiError(
            502,
            "PROVIDER_RESPONSE_INVALID",
            "The market data provider returned data in an unexpected format.",
            parsed.error.issues.map((issue) => issue.message)
          );
        }

        // 6. Cross-field validation + normalization.
        return normalize(ticker, range, parsed.data);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
