import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAlphaVantageClient,
  MAX_SERIES_POINTS,
  type FetchLike,
} from "../src/services/alphaVantageClient";

const BASE_URL = "https://example.test/query";

function bar(open: number, high: number, low: number, close: number, volume: number) {
  return {
    "1. open": String(open),
    "2. high": String(high),
    "3. low": String(low),
    "4. close": String(close),
    "5. volume": String(volume),
  };
}

function successPayload(symbol: string, series: Record<string, unknown>) {
  return {
    "Meta Data": {
      "1. Information": "Daily Prices",
      "2. Symbol": symbol,
      "3. Last Refreshed": "2026-06-19",
      "4. Output Size": "Compact",
      "5. Time Zone": "US/Eastern",
    },
    "Time Series (Daily)": series,
  };
}

function fetchReturning(payload: unknown, init: { ok?: boolean; status?: number } = {}): FetchLike {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  }));
}

function fetchNonJson(init: { ok?: boolean; status?: number } = {}): FetchLike {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  }));
}

/** Fetch stub with a controllable content-type header and JSON behavior. */
function fetchWith(
  payload: unknown,
  init: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    throwJson?: boolean;
  } = {}
): FetchLike {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? (init.contentType ?? null) : null,
    },
    json: async () => {
      if (init.throwJson) {
        throw new SyntaxError("Unexpected end of JSON input");
      }
      return payload;
    },
  }));
}

function makeClient(fetchFn: FetchLike, apiKey = "TEST_KEY") {
  return createAlphaVantageClient({ apiKey, baseUrl: BASE_URL, fetchFn });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("alphaVantageClient — success & normalization", () => {
  it("normalizes, sorts ascending, sets adjustedClose/currency null", async () => {
    const payload = successPayload("IBM", {
      "2026-06-19": bar(100, 105, 99, 104, 1000),
      "2026-06-18": bar(98, 101, 97, 100, 900),
    });
    const series = await makeClient(fetchReturning(payload)).fetchDailySeries("IBM");

    expect(series.ticker).toBe("IBM");
    expect(series.range).toBe("3m"); // default window when none is requested
    expect(series.currency).toBeNull();
    expect(series.priceBasis).toBe("close");
    expect(series.timezone).toBe("US/Eastern");
    expect(series.lastRefreshed).toBe("2026-06-19");
    expect(series.bars.map((b) => b.date)).toEqual(["2026-06-18", "2026-06-19"]);
    expect(series.bars[1]).toMatchObject({ close: 104, adjustedClose: null, volume: 1000 });
  });

  it("passes an AbortSignal to fetch", async () => {
    const fetchFn = fetchReturning(successPayload("IBM", { "2026-06-18": bar(1, 2, 1, 1.5, 10) }));
    await makeClient(fetchFn).fetchDailySeries("IBM");
    const [, init] = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect((init as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("alphaVantageClient — advisory envelopes (HTTP 200)", () => {
  it("Error Message (invalid call) -> 404 SYMBOL_NOT_FOUND", async () => {
    const client = makeClient(fetchReturning({ "Error Message": "Invalid API call." }));
    await expect(client.fetchDailySeries("ZZZZ")).rejects.toMatchObject({
      status: 404,
      code: "SYMBOL_NOT_FOUND",
    });
  });

  it("Error Message mentioning the API key -> 401 API_KEY_INVALID", async () => {
    const client = makeClient(fetchReturning({ "Error Message": "the parameter apikey is invalid." }));
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 401,
      code: "API_KEY_INVALID",
    });
  });

  it("Note -> 429 PROVIDER_RATE_LIMITED", async () => {
    const client = makeClient(fetchReturning({ Note: "Thank you for using Alpha Vantage..." }));
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 429,
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("Information about the daily limit -> 429 PROVIDER_RATE_LIMITED", async () => {
    const client = makeClient(
      fetchReturning({ Information: "Our standard API rate limit is 25 requests per day." })
    );
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 429,
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("Information that is NOT a rate limit -> 502 PROVIDER_UNAVAILABLE (not blanket rate-limit)", async () => {
    const client = makeClient(fetchReturning({ Information: "This endpoint is undergoing maintenance." }));
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
    });
  });
});

describe("alphaVantageClient — HTTP status classification", () => {
  const cases: Array<[number, string, number]> = [
    [429, "PROVIDER_RATE_LIMITED", 429],
    [401, "API_KEY_INVALID", 401],
    [403, "API_KEY_INVALID", 401],
    [500, "PROVIDER_UNAVAILABLE", 502],
    [502, "PROVIDER_UNAVAILABLE", 502],
    [503, "PROVIDER_UNAVAILABLE", 502],
    [504, "PROVIDER_TIMEOUT", 504],
    [404, "PROVIDER_UNAVAILABLE", 502],
  ];

  it.each(cases)("HTTP %i -> %s", async (httpStatus, code, status) => {
    const client = makeClient(fetchReturning({}, { ok: false, status: httpStatus }));
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({ status, code });
  });
});

describe("alphaVantageClient — transport / shape failures", () => {
  it("network error -> 502 PROVIDER_UNAVAILABLE", async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(makeClient(fetchFn).fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("non-JSON (HTML) body -> 502 PROVIDER_RESPONSE_INVALID", async () => {
    await expect(makeClient(fetchNonJson()).fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("unexpected payload shape -> 502 PROVIDER_RESPONSE_INVALID", async () => {
    const client = makeClient(fetchReturning({ foo: "bar" }));
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });
});

describe("alphaVantageClient — cross-field validation", () => {
  it("symbol mismatch -> PROVIDER_RESPONSE_INVALID", async () => {
    const payload = successPayload("MSFT", { "2026-06-18": bar(1, 2, 1, 1.5, 10) });
    await expect(makeClient(fetchReturning(payload)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("invalid date -> PROVIDER_RESPONSE_INVALID", async () => {
    const payload = successPayload("IBM", { "2026-13-40": bar(1, 2, 1, 1.5, 10) });
    await expect(makeClient(fetchReturning(payload)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("high < low -> PROVIDER_RESPONSE_INVALID", async () => {
    const payload = successPayload("IBM", { "2026-06-18": bar(10, 9, 11, 10, 10) });
    await expect(makeClient(fetchReturning(payload)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("close outside [low, high] -> PROVIDER_RESPONSE_INVALID", async () => {
    const payload = successPayload("IBM", { "2026-06-18": bar(10, 12, 9, 20, 10) });
    await expect(makeClient(fetchReturning(payload)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("negative / zero price -> PROVIDER_RESPONSE_INVALID (schema)", async () => {
    const negative = successPayload("IBM", { "2026-06-18": bar(-1, 2, -3, 1, 10) });
    await expect(makeClient(fetchReturning(negative)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
    const zero = successPayload("IBM", { "2026-06-18": bar(0, 2, 0, 1, 10) });
    await expect(makeClient(fetchReturning(zero)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("fractional / negative volume -> PROVIDER_RESPONSE_INVALID", async () => {
    const fractional = successPayload("IBM", { "2026-06-18": bar(1, 2, 1, 1.5, 10.5) });
    await expect(makeClient(fetchReturning(fractional)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
    const negative = successPayload("IBM", { "2026-06-18": bar(1, 2, 1, 1.5, -10) });
    await expect(makeClient(fetchReturning(negative)).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("oversized response (> MAX_SERIES_POINTS) -> PROVIDER_RESPONSE_INVALID", async () => {
    const big: Record<string, ReturnType<typeof bar>> = {};
    for (let i = 0; i < MAX_SERIES_POINTS + 5; i += 1) {
      const day = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      big[day] = bar(1, 2, 1, 1.5, 10);
    }
    await expect(
      makeClient(fetchReturning(successPayload("IBM", big))).fetchDailySeries("IBM")
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
  });

  it("empty time series -> 422 INSUFFICIENT_DATA", async () => {
    const payload = successPayload("IBM", {});
    await expect(makeClient(fetchReturning(payload)).fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 422,
      code: "INSUFFICIENT_DATA",
    });
  });
});

describe("alphaVantageClient — timeout (fake timers)", () => {
  it("aborts after the timeout and maps to PROVIDER_TIMEOUT, cleaning the timer", async () => {
    vi.useFakeTimers();
    let captured: AbortSignal | undefined;
    const fetchFn: FetchLike = (_, init) =>
      new Promise((_resolve, reject) => {
        captured = init?.signal;
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });

    const client = createAlphaVantageClient({
      apiKey: "K",
      baseUrl: BASE_URL,
      fetchFn,
      timeoutMs: 8000,
    });

    const promise = client.fetchDailySeries("IBM");
    promise.catch(() => {}); // avoid unhandled rejection during timer advance

    await vi.advanceTimersByTimeAsync(8000);

    expect(captured?.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ status: 504, code: "PROVIDER_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0); // timer cleared
  });

  it("clears the timeout timer after a fast success", async () => {
    vi.useFakeTimers();
    const payload = successPayload("IBM", { "2026-06-18": bar(1, 2, 1, 1.5, 10) });
    const client = createAlphaVantageClient({
      apiKey: "K",
      baseUrl: BASE_URL,
      fetchFn: fetchReturning(payload),
      timeoutMs: 8000,
    });

    await client.fetchDailySeries("IBM");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("alphaVantageClient — HTTP 400 / 408 / unknown status", () => {
  const cases: Array<[number, string, number]> = [
    [400, "PROVIDER_RESPONSE_INVALID", 502],
    [408, "PROVIDER_TIMEOUT", 504],
    [418, "PROVIDER_UNAVAILABLE", 502], // unknown -> safe fallback
  ];

  it.each(cases)("HTTP %i -> %s", async (httpStatus, code, status) => {
    const client = makeClient(fetchReturning({}, { ok: false, status: httpStatus }));
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({ status, code });
  });
});

describe("alphaVantageClient — Content-Type handling", () => {
  const okBar = { "2026-06-18": bar(1, 2, 1, 1.5, 10) };

  it("accepts application/json with a charset parameter", async () => {
    const fetchFn = fetchWith(successPayload("IBM", okBar), {
      contentType: "application/json; charset=utf-8",
    });
    const series = await makeClient(fetchFn).fetchDailySeries("IBM");
    expect(series.ticker).toBe("IBM");
  });

  it("accepts a response with no Content-Type header (parses JSON)", async () => {
    const fetchFn = fetchWith(successPayload("IBM", okBar), { contentType: null });
    const series = await makeClient(fetchFn).fetchDailySeries("IBM");
    expect(series.bars).toHaveLength(1);
  });

  it("rejects a text/html 200 page WITHOUT parsing it -> PROVIDER_RESPONSE_INVALID", async () => {
    // json() would succeed, but the content-type gate must reject first.
    const fetchFn = fetchWith(successPayload("IBM", okBar), { contentType: "text/html" });
    await expect(makeClient(fetchFn).fetchDailySeries("IBM")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("rejects text/plain -> PROVIDER_RESPONSE_INVALID", async () => {
    const fetchFn = fetchWith("just text", { contentType: "text/plain" });
    await expect(makeClient(fetchFn).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("maps an empty / malformed JSON body to PROVIDER_RESPONSE_INVALID", async () => {
    const fetchFn = fetchWith(undefined, { contentType: "application/json", throwJson: true });
    await expect(makeClient(fetchFn).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
    });
  });

  // Strict media-type matching: only `application/json` or a `+json` suffix.
  const mediaTypes: Array<[string, boolean]> = [
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["Application/JSON", true],
    ["application/problem+json", true],
    ["application/vnd.api+json", true],
    ["application/notjson", false],
    ["text/jsonish", false],
    ["application/jsonp", false],
  ];

  it.each(mediaTypes)("treats Content-Type %s as JSON=%s", async (contentType, isJson) => {
    const fetchFn = fetchWith(successPayload("IBM", okBar), { contentType });
    const promise = makeClient(fetchFn).fetchDailySeries("IBM");
    if (isJson) {
      await expect(promise).resolves.toMatchObject({ ticker: "IBM" });
    } else {
      await expect(promise).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
    }
  });
});

describe("alphaVantageClient — advisory classification (HTTP 200)", () => {
  const cases: Array<[string, "Error Message" | "Note" | "Information", string]> = [
    ["entitlement/premium endpoint", "Information", "This is a premium endpoint."],
    ["unsupported function", "Information", "unsupported function for your plan"],
    ["daily quota", "Information", "You have reached your daily quota of requests."],
    ["malformed symbol", "Error Message", "malformed symbol provided"],
    ["unknown Error Message -> symbol", "Error Message", "totally unrecognized text"],
    ["unknown Information -> unavailable", "Information", "totally unrecognized text"],
  ];

  const expected: Record<string, string> = {
    "This is a premium endpoint.": "API_KEY_INVALID",
    "unsupported function for your plan": "API_KEY_INVALID",
    "You have reached your daily quota of requests.": "PROVIDER_RATE_LIMITED",
    "malformed symbol provided": "SYMBOL_NOT_FOUND",
  };

  it.each(cases)("%s", async (_label, key, message) => {
    const client = makeClient(fetchReturning({ [key]: message }));
    const expectedCode =
      expected[message] ?? (key === "Error Message" ? "SYMBOL_NOT_FOUND" : "PROVIDER_UNAVAILABLE");
    await expect(client.fetchDailySeries("IBM")).rejects.toMatchObject({ code: expectedCode });
  });
});

describe("alphaVantageClient — max points (early guard before per-row parse)", () => {
  function seriesOfSize(n: number, makeBar: () => unknown = () => bar(1, 2, 1, 1.5, 10)) {
    const series: Record<string, unknown> = {};
    for (let i = 0; i < n; i += 1) {
      series[new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)] = makeBar();
    }
    return series;
  }
  function clientWith(payload: unknown, maxPoints = 5) {
    return createAlphaVantageClient({
      apiKey: "K",
      baseUrl: BASE_URL,
      fetchFn: fetchReturning(payload),
      maxPoints,
    });
  }

  it("accepts exactly maxPoints rows", async () => {
    const result = await clientWith(successPayload("IBM", seriesOfSize(5))).fetchDailySeries("IBM");
    expect(result.bars).toHaveLength(5);
  });

  it("rejects maxPoints + 1 rows up front (details=too-many-points, no truncation)", async () => {
    await expect(
      clientWith(successPayload("IBM", seriesOfSize(6))).fetchDailySeries("IBM")
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID", details: "too-many-points" });
  });

  it("short-circuits BEFORE per-row parse: oversized + invalid rows still report size", async () => {
    // Each row is structurally invalid. If the size guard did NOT run first, the
    // failure would be a schema/parse error rather than "too-many-points".
    const invalid = seriesOfSize(6, () => ({ garbage: true }));
    await expect(
      clientWith(successPayload("IBM", invalid)).fetchDailySeries("IBM")
    ).rejects.toMatchObject({ details: "too-many-points" });
  });

  it.each([
    ["array", [] as unknown],
    ["null", null as unknown],
    ["string", "oops" as unknown],
  ])("rejects a non-object Time Series (%s) with details=timeseries-shape", async (_label, ts) => {
    const payload = {
      "Meta Data": {
        "2. Symbol": "IBM",
        "3. Last Refreshed": "2026-06-19",
        "5. Time Zone": "US/Eastern",
      },
      "Time Series (Daily)": ts,
    };
    await expect(clientWith(payload).fetchDailySeries("IBM")).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      details: "timeseries-shape",
    });
  });
});

describe("alphaVantageClient — secret & provider-message non-disclosure", () => {
  it("never includes the API key in thrown errors", async () => {
    const apiKey = "TOP_SECRET_KEY_123";
    const client = makeClient(fetchReturning({ "Error Message": "Invalid API call." }), apiKey);
    try {
      await client.fetchDailySeries("ZZZZ");
      throw new Error("expected rejection");
    } catch (err) {
      const serialized = JSON.stringify({
        message: (err as Error).message,
        details: (err as { details?: unknown }).details,
      });
      expect(serialized).not.toContain(apiKey);
    }
  });

  it("never echoes the provider's raw advisory message", async () => {
    const rawMessage = "PROPRIETARY-PROVIDER-INTERNAL-NOTE-9f8a";
    const client = makeClient(fetchReturning({ Information: `Rate limit. ${rawMessage}` }));
    try {
      await client.fetchDailySeries("IBM");
      throw new Error("expected rejection");
    } catch (err) {
      const serialized = JSON.stringify({
        message: (err as Error).message,
        details: (err as { details?: unknown }).details,
      });
      expect(serialized).not.toContain(rawMessage);
    }
  });

  it("never includes the provider URL or API key in HTTP-status errors", async () => {
    const apiKey = "URL_LEAK_KEY";
    const client = makeClient(fetchReturning({}, { ok: false, status: 500 }), apiKey);
    try {
      await client.fetchDailySeries("IBM");
      throw new Error("expected rejection");
    } catch (err) {
      const serialized = JSON.stringify({
        message: (err as Error).message,
        details: (err as { details?: unknown }).details,
      });
      expect(serialized).not.toContain(apiKey);
      expect(serialized).not.toContain("alphavantage.co");
      expect(serialized).not.toContain("apikey=");
    }
  });
});
