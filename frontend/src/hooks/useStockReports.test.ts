import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useStockReports } from "./useStockReports";
import { makeReport } from "../test/fixtures";

// Mock the API layer so the hook never touches the network.
vi.mock("../lib/api", () => {
  class StockApiError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { StockApiError, fetchStockReport: vi.fn() };
});

import { fetchStockReport, StockApiError } from "../lib/api";

const mockFetch = fetchStockReport as unknown as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStockReports — lazy, on-demand fetching", () => {
  it("fetches nothing until a ticker is explicitly requested", () => {
    renderHook(() => useStockReports());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches exactly one ticker per request and populates success", async () => {
    mockFetch.mockImplementation(async (ticker: string) => makeReport({ ticker }));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));

    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("success"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("AAPL", expect.anything());
  });

  it("populates error state from a StockApiError", async () => {
    mockFetch.mockRejectedValue(new StockApiError("見つかりません", "SYMBOL_NOT_FOUND", 404));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("ZZZZ"));

    await waitFor(() => expect(result.current.reports.ZZZZ?.status).toBe("error"));
    expect(result.current.reports.ZZZZ).toMatchObject({ status: "error", code: "SYMBOL_NOT_FOUND" });
  });

  it("de-duplicates concurrent requests for the same ticker into one call", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL");
      result.current.request("AAPL");
      result.current.request("AAPL");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.pending.AAPL).toBe(true);

    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL" }));
      await gate.promise;
    });
    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("success"));
    expect(result.current.pending.AAPL).toBeFalsy();
  });

  it("serves the kept success state on re-request (no second call)", async () => {
    mockFetch.mockImplementation(async (ticker: string) => makeReport({ ticker }));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("success"));

    act(() => result.current.request("AAPL"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT auto-retry an errored ticker on re-request, but refetch does", async () => {
    mockFetch.mockRejectedValueOnce(new StockApiError("制限", "PROVIDER_RATE_LIMITED", 429));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("error"));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Re-selecting the ticker must not silently retry.
    act(() => result.current.request("AAPL"));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Explicit retry does.
    mockFetch.mockResolvedValueOnce(makeReport({ ticker: "AAPL" }));
    act(() => result.current.refetch("AAPL"));
    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("success"));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refetch is ignored while a request is already in flight (no double submit)", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    act(() => {
      result.current.refetch("AAPL");
      result.current.refetch("AAPL");
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL" }));
      await gate.promise;
    });
  });

  it("keeps separate tickers independent", async () => {
    mockFetch.mockImplementation(async (ticker: string) => makeReport({ ticker }));
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL");
      result.current.request("MSFT");
    });

    await waitFor(() => expect(result.current.reports.MSFT?.status).toBe("success"));
    expect(result.current.reports.AAPL?.status).toBe("success");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("useStockReports — request lifecycle (abort / stale / unmount)", () => {
  it("aborts the in-flight request and clears state when a ticker is forgotten", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    const signal = mockFetch.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(result.current.pending.AAPL).toBe(true);

    act(() => result.current.forget("AAPL"));

    // The request's signal is aborted, and kept/pending state is gone at once.
    expect(signal.aborted).toBe(true);
    expect(result.current.reports.AAPL).toBeUndefined();
    expect(result.current.pending.AAPL).toBeFalsy();

    // A late resolve after forget must not revive the report or raise an error.
    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL" }));
      await Promise.resolve();
    });
    expect(result.current.reports.AAPL).toBeUndefined();
    expect(result.current.pending.AAPL).toBeFalsy();
  });

  it("re-adding a forgotten ticker shows only the NEW request's result", async () => {
    const first = deferred<ReturnType<typeof makeReport>>();
    const second = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL")); // old request
    act(() => result.current.forget("AAPL")); // removed
    act(() => result.current.request("AAPL")); // re-added -> new request
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The OLD response arrives late: it must be ignored.
    await act(async () => {
      first.resolve(makeReport({ ticker: "AAPL", lastRefreshed: "OLD" }));
      await Promise.resolve();
    });
    expect(result.current.reports.AAPL?.status).toBe("loading");

    // The NEW response is the one that wins.
    await act(async () => {
      second.resolve(makeReport({ ticker: "AAPL", lastRefreshed: "NEW" }));
      await Promise.resolve();
    });
    const state = result.current.reports.AAPL;
    expect(state).toMatchObject({ status: "success" });
    expect(state?.status === "success" && state.report.lastRefreshed).toBe("NEW");
  });

  it("does not update state (or warn) after the component unmounts", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result, unmount } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    const signal = mockFetch.mock.calls[0][1] as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true); // unmount aborts in-flight requests

    // A late settle after unmount must not throw, warn, or update state.
    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL" }));
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not surface an unhandled rejection when a request is aborted", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    act(() => result.current.forget("AAPL"));

    // Reject like a real aborted fetch would; the hook must swallow it.
    await act(async () => {
      gate.reject(new DOMException("Aborted", "AbortError"));
      await Promise.resolve();
    });
    expect(result.current.reports.AAPL).toBeUndefined();
  });
});

describe("useStockReports — retry lifecycle", () => {
  it("allows retry after failure, and forgetting mid-retry aborts without reviving", async () => {
    // Initial failure.
    mockFetch.mockRejectedValueOnce(new StockApiError("制限", "PROVIDER_RATE_LIMITED", 429));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL"));
    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("error"));

    // Retry: a controllable in-flight request.
    const retry = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementationOnce(() => retry.promise);
    act(() => result.current.refetch("AAPL"));
    expect(result.current.pending.AAPL).toBe(true);
    const retrySignal = mockFetch.mock.calls[1][1] as AbortSignal;

    // Forget during retry -> abort + invalidate.
    act(() => result.current.forget("AAPL"));
    expect(retrySignal.aborted).toBe(true);
    expect(result.current.reports.AAPL).toBeUndefined();

    // The stale retry result must not revive the removed ticker.
    await act(async () => {
      retry.resolve(makeReport({ ticker: "AAPL", lastRefreshed: "STALE" }));
      await Promise.resolve();
    });
    expect(result.current.reports.AAPL).toBeUndefined();
    expect(result.current.pending.AAPL).toBeFalsy();
  });
});
