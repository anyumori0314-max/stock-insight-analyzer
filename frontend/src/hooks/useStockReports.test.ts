import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { reportKey, useStockReports } from "./useStockReports";
import type { StockRange } from "../lib/ranges";
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

/** Default window used across the per-ticker behaviour tests. */
const R: StockRange = "3m";
const key = (ticker: string, range: StockRange = R) => reportKey(ticker, range);

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
  it("fetches nothing until a (ticker, range) is explicitly requested", () => {
    renderHook(() => useStockReports());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches exactly one pair per request and populates success", async () => {
    mockFetch.mockImplementation(async (ticker: string, range: StockRange) =>
      makeReport({ ticker, range })
    );
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));

    await waitFor(() => expect(result.current.reports[key("AAPL")]?.status).toBe("success"));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Called with the ticker, the range, AND an abort signal — never just a ticker.
    expect(mockFetch).toHaveBeenCalledWith("AAPL", R, expect.anything());
  });

  it("populates error state from a StockApiError", async () => {
    mockFetch.mockRejectedValue(new StockApiError("見つかりません", "SYMBOL_NOT_FOUND", 404));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("ZZZZ", R));

    await waitFor(() => expect(result.current.reports[key("ZZZZ")]?.status).toBe("error"));
    expect(result.current.reports[key("ZZZZ")]).toMatchObject({
      status: "error",
      code: "SYMBOL_NOT_FOUND",
    });
  });

  it("de-duplicates concurrent requests for the same (ticker, range) into one call", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL", R);
      result.current.request("AAPL", R);
      result.current.request("AAPL", R);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.pending[key("AAPL")]).toBe(true);

    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL", range: R }));
      await gate.promise;
    });
    await waitFor(() => expect(result.current.reports[key("AAPL")]?.status).toBe("success"));
    expect(result.current.pending[key("AAPL")]).toBeFalsy();
  });

  it("serves the kept success state on re-request (no second call)", async () => {
    mockFetch.mockImplementation(async (ticker: string, range: StockRange) =>
      makeReport({ ticker, range })
    );
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    await waitFor(() => expect(result.current.reports[key("AAPL")]?.status).toBe("success"));

    act(() => result.current.request("AAPL", R));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT auto-retry an errored pair on re-request, but refetch does", async () => {
    mockFetch.mockRejectedValueOnce(new StockApiError("制限", "PROVIDER_RATE_LIMITED", 429));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    await waitFor(() => expect(result.current.reports[key("AAPL")]?.status).toBe("error"));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Re-selecting the pair must not silently retry.
    act(() => result.current.request("AAPL", R));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Explicit retry does.
    mockFetch.mockResolvedValueOnce(makeReport({ ticker: "AAPL", range: R }));
    act(() => result.current.refetch("AAPL", R));
    await waitFor(() => expect(result.current.reports[key("AAPL")]?.status).toBe("success"));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refetch is ignored while a request is already in flight (no double submit)", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    act(() => {
      result.current.refetch("AAPL", R);
      result.current.refetch("AAPL", R);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL", range: R }));
      await gate.promise;
    });
  });

  it("keeps separate tickers independent", async () => {
    mockFetch.mockImplementation(async (ticker: string, range: StockRange) =>
      makeReport({ ticker, range })
    );
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL", R);
      result.current.request("MSFT", R);
    });

    await waitFor(() => expect(result.current.reports[key("MSFT")]?.status).toBe("success"));
    expect(result.current.reports[key("AAPL")]?.status).toBe("success");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("useStockReports — per-range isolation", () => {
  it("treats different ranges of the same ticker as separate requests", async () => {
    mockFetch.mockImplementation(async (ticker: string, range: StockRange) =>
      makeReport({ ticker, range })
    );
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL", "1m");
      result.current.request("AAPL", "3m");
    });

    await waitFor(() => expect(result.current.reports[key("AAPL", "3m")]?.status).toBe("success"));
    expect(result.current.reports[key("AAPL", "1m")]?.status).toBe("success");
    // Two distinct windows -> two calls, one per window.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith("AAPL", "1m", expect.anything());
    expect(mockFetch).toHaveBeenCalledWith("AAPL", "3m", expect.anything());
  });

  it("switching back to an already-loaded range does not re-fetch", async () => {
    mockFetch.mockImplementation(async (ticker: string, range: StockRange) =>
      makeReport({ ticker, range })
    );
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", "3m"));
    await waitFor(() => expect(result.current.reports[key("AAPL", "3m")]?.status).toBe("success"));

    act(() => result.current.request("AAPL", "1m"));
    await waitFor(() => expect(result.current.reports[key("AAPL", "1m")]?.status).toBe("success"));
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Returning to the first window serves the cached pair — no third call.
    act(() => result.current.request("AAPL", "3m"));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not let a slow range's late response leak into another range", async () => {
    const slow = deferred<ReturnType<typeof makeReport>>();
    const fast = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", "1m")); // slow
    act(() => result.current.request("AAPL", "3m")); // fast

    await act(async () => {
      fast.resolve(makeReport({ ticker: "AAPL", range: "3m", lastRefreshed: "FAST" }));
      await Promise.resolve();
    });
    await act(async () => {
      slow.resolve(makeReport({ ticker: "AAPL", range: "1m", lastRefreshed: "SLOW" }));
      await Promise.resolve();
    });

    const oneM = result.current.reports[key("AAPL", "1m")];
    const threeM = result.current.reports[key("AAPL", "3m")];
    expect(oneM?.status === "success" && oneM.report.lastRefreshed).toBe("SLOW");
    expect(threeM?.status === "success" && threeM.report.lastRefreshed).toBe("FAST");
  });
});

describe("useStockReports — request lifecycle (abort / stale / unmount)", () => {
  it("aborts the in-flight request and clears state when a pair is forgotten", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    const signal = mockFetch.mock.calls[0][2] as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(result.current.pending[key("AAPL")]).toBe(true);

    act(() => result.current.forget("AAPL"));

    // The request's signal is aborted, and kept/pending state is gone at once.
    expect(signal.aborted).toBe(true);
    expect(result.current.reports[key("AAPL")]).toBeUndefined();
    expect(result.current.pending[key("AAPL")]).toBeFalsy();

    // A late resolve after forget must not revive the report or raise an error.
    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL", range: R }));
      await Promise.resolve();
    });
    expect(result.current.reports[key("AAPL")]).toBeUndefined();
    expect(result.current.pending[key("AAPL")]).toBeFalsy();
  });

  it("forget drops EVERY window of a ticker and aborts each in-flight request", async () => {
    const oneM = deferred<ReturnType<typeof makeReport>>();
    const threeM = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementationOnce(() => oneM.promise).mockImplementationOnce(() => threeM.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL", "1m");
      result.current.request("AAPL", "3m");
    });
    const signal1m = mockFetch.mock.calls[0][2] as AbortSignal;
    const signal3m = mockFetch.mock.calls[1][2] as AbortSignal;
    expect(result.current.pending[key("AAPL", "1m")]).toBe(true);
    expect(result.current.pending[key("AAPL", "3m")]).toBe(true);

    act(() => result.current.forget("AAPL"));

    // Both windows aborted and cleared in one call.
    expect(signal1m.aborted).toBe(true);
    expect(signal3m.aborted).toBe(true);
    expect(result.current.reports[key("AAPL", "1m")]).toBeUndefined();
    expect(result.current.reports[key("AAPL", "3m")]).toBeUndefined();
    expect(result.current.pending[key("AAPL", "1m")]).toBeFalsy();
    expect(result.current.pending[key("AAPL", "3m")]).toBeFalsy();

    // Neither late resolve revives the ticker.
    await act(async () => {
      oneM.resolve(makeReport({ ticker: "AAPL", range: "1m" }));
      threeM.resolve(makeReport({ ticker: "AAPL", range: "3m" }));
      await Promise.resolve();
    });
    expect(result.current.reports[key("AAPL", "1m")]).toBeUndefined();
    expect(result.current.reports[key("AAPL", "3m")]).toBeUndefined();
  });

  it("forget leaves OTHER tickers untouched", async () => {
    mockFetch.mockImplementation(async (ticker: string, range: StockRange) =>
      makeReport({ ticker, range })
    );
    const { result } = renderHook(() => useStockReports());

    act(() => {
      result.current.request("AAPL", R);
      result.current.request("MSFT", R);
    });
    await waitFor(() => expect(result.current.reports[key("MSFT")]?.status).toBe("success"));

    act(() => result.current.forget("AAPL"));
    expect(result.current.reports[key("AAPL")]).toBeUndefined();
    expect(result.current.reports[key("MSFT")]?.status).toBe("success");
  });

  it("re-adding a forgotten pair shows only the NEW request's result", async () => {
    const first = deferred<ReturnType<typeof makeReport>>();
    const second = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R)); // old request
    act(() => result.current.forget("AAPL")); // removed
    act(() => result.current.request("AAPL", R)); // re-added -> new request
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // The OLD response arrives late: it must be ignored.
    await act(async () => {
      first.resolve(makeReport({ ticker: "AAPL", range: R, lastRefreshed: "OLD" }));
      await Promise.resolve();
    });
    expect(result.current.reports[key("AAPL")]?.status).toBe("loading");

    // The NEW response is the one that wins.
    await act(async () => {
      second.resolve(makeReport({ ticker: "AAPL", range: R, lastRefreshed: "NEW" }));
      await Promise.resolve();
    });
    const state = result.current.reports[key("AAPL")];
    expect(state).toMatchObject({ status: "success" });
    expect(state?.status === "success" && state.report.lastRefreshed).toBe("NEW");
  });

  it("does not update state (or warn) after the component unmounts", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result, unmount } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    const signal = mockFetch.mock.calls[0][2] as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true); // unmount aborts in-flight requests

    // A late settle after unmount must not throw, warn, or update state.
    await act(async () => {
      gate.resolve(makeReport({ ticker: "AAPL", range: R }));
      await Promise.resolve();
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not surface an unhandled rejection when a request is aborted", async () => {
    const gate = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(() => gate.promise);
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    act(() => result.current.forget("AAPL"));

    // Reject like a real aborted fetch would; the hook must swallow it.
    await act(async () => {
      gate.reject(new DOMException("Aborted", "AbortError"));
      await Promise.resolve();
    });
    expect(result.current.reports[key("AAPL")]).toBeUndefined();
  });
});

describe("useStockReports — retry lifecycle", () => {
  it("allows retry after failure, and forgetting mid-retry aborts without reviving", async () => {
    // Initial failure.
    mockFetch.mockRejectedValueOnce(new StockApiError("制限", "PROVIDER_RATE_LIMITED", 429));
    const { result } = renderHook(() => useStockReports());

    act(() => result.current.request("AAPL", R));
    await waitFor(() => expect(result.current.reports[key("AAPL")]?.status).toBe("error"));

    // Retry: a controllable in-flight request.
    const retry = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementationOnce(() => retry.promise);
    act(() => result.current.refetch("AAPL", R));
    expect(result.current.pending[key("AAPL")]).toBe(true);
    const retrySignal = mockFetch.mock.calls[1][2] as AbortSignal;

    // Forget during retry -> abort + invalidate.
    act(() => result.current.forget("AAPL"));
    expect(retrySignal.aborted).toBe(true);
    expect(result.current.reports[key("AAPL")]).toBeUndefined();

    // The stale retry result must not revive the removed ticker.
    await act(async () => {
      retry.resolve(makeReport({ ticker: "AAPL", range: R, lastRefreshed: "STALE" }));
      await Promise.resolve();
    });
    expect(result.current.reports[key("AAPL")]).toBeUndefined();
    expect(result.current.pending[key("AAPL")]).toBeFalsy();
  });
});
