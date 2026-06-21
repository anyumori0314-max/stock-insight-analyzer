import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchStockReport, StockApiError } from "./api";
import { jsonResponse, makeReport } from "../test/fixtures";

function mockFetch(impl: Parameters<typeof vi.fn>[0]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchStockReport — success", () => {
  it("validates and returns a contract-valid report", async () => {
    mockFetch(async () => jsonResponse(makeReport()));
    const report = await fetchStockReport("AAPL");
    expect(report.ticker).toBe("AAPL");
    expect(report.metrics.currentPrice).toBe(104);
  });
});

describe("fetchStockReport — error status mapping", () => {
  const cases: Array<[number, string]> = [
    [400, "INVALID_TICKER"],
    [404, "SYMBOL_NOT_FOUND"],
    [429, "PROVIDER_RATE_LIMITED"],
    [500, "INTERNAL_SERVER_ERROR"],
    [503, "API_KEY_MISSING"],
  ];

  it.each(cases)("HTTP %i (%s) -> StockApiError with that code", async (status, code) => {
    mockFetch(async () => jsonResponse({ error: { code, message: "x" } }, { ok: false, status }));
    await expect(fetchStockReport("AAPL")).rejects.toMatchObject({ code, status });
  });

  it("surfaces a friendly message, never internal details", async () => {
    mockFetch(async () =>
      jsonResponse({ error: { code: "SYMBOL_NOT_FOUND", message: "secret internal" } }, { ok: false, status: 404 })
    );
    const error = await fetchStockReport("ZZZZ").catch((e) => e);
    expect(error).toBeInstanceOf(StockApiError);
    expect((error as StockApiError).message).toContain("見つかりません");
    expect((error as StockApiError).message).not.toContain("secret internal");
  });
});

describe("fetchStockReport — invalid responses", () => {
  it("rejects with RESPONSE_INVALID when the body is not JSON", async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }) as unknown as Response);
    await expect(fetchStockReport("AAPL")).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
  });

  it("rejects with RESPONSE_INVALID when the shape fails the contract", async () => {
    mockFetch(async () => jsonResponse({ ticker: "AAPL" })); // missing required fields
    await expect(fetchStockReport("AAPL")).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
  });

  it("rejects with RESPONSE_INVALID when a numeric field is Infinity-like (null after JSON)", async () => {
    const bad = makeReport();
    // currentPrice must be a finite number; null violates the contract.
    (bad.metrics as unknown as { currentPrice: number | null }).currentPrice = null;
    mockFetch(async () => jsonResponse(bad));
    await expect(fetchStockReport("AAPL")).rejects.toMatchObject({ code: "RESPONSE_INVALID" });
  });
});

describe("fetchStockReport — network / timeout / abort", () => {
  it("maps a network failure to NETWORK_ERROR", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchStockReport("AAPL")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("times out via the client-side AbortController", async () => {
    vi.useFakeTimers();
    mockFetch(
      (_, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init as { signal?: AbortSignal } | undefined)?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    const promise = fetchStockReport("AAPL");
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("re-throws a genuine caller abort (not a user-facing error)", async () => {
    const controller = new AbortController();
    mockFetch(
      (_, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init as { signal?: AbortSignal } | undefined)?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    const promise = fetchStockReport("AAPL", controller.signal);
    controller.abort();
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).not.toBeInstanceOf(StockApiError);
  });
});
