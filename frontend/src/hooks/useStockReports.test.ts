import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

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

describe("useStockReports", () => {
  it("populates success state", async () => {
    mockFetch.mockImplementation(async (ticker: string) => makeReport({ ticker }));
    const { result } = renderHook(() => useStockReports(["AAPL"]));

    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("success"));
    const state = result.current.reports.AAPL;
    expect(state).toMatchObject({ status: "success" });
  });

  it("populates error state from a StockApiError", async () => {
    mockFetch.mockRejectedValue(new StockApiError("見つかりません", "SYMBOL_NOT_FOUND", 404));
    const { result } = renderHook(() => useStockReports(["ZZZZ"]));

    await waitFor(() => expect(result.current.reports.ZZZZ?.status).toBe("error"));
    expect(result.current.reports.ZZZZ).toMatchObject({ status: "error", code: "SYMBOL_NOT_FOUND" });
  });

  it("ignores a late response for a ticker that was removed (no stale revival)", async () => {
    const slow = deferred<ReturnType<typeof makeReport>>();
    mockFetch.mockImplementation(async (ticker: string) => {
      if (ticker === "AAPL") return slow.promise;
      return makeReport({ ticker });
    });

    const { result, rerender } = renderHook(({ t }) => useStockReports(t), {
      initialProps: { t: ["AAPL"] },
    });

    // Replace the selection before AAPL resolves.
    rerender({ t: ["MSFT"] });
    await waitFor(() => expect(result.current.reports.MSFT?.status).toBe("success"));

    // Now resolve the stale AAPL request: it must NOT reappear.
    slow.resolve(makeReport({ ticker: "AAPL" }));
    await Promise.resolve();
    expect(result.current.reports.AAPL).toBeUndefined();
    expect(Object.keys(result.current.reports)).toEqual(["MSFT"]);
  });

  it("keeps already-loaded tickers without re-fetching", async () => {
    mockFetch.mockImplementation(async (ticker: string) => makeReport({ ticker }));
    const { result, rerender } = renderHook(({ t }) => useStockReports(t), {
      initialProps: { t: ["AAPL"] },
    });
    await waitFor(() => expect(result.current.reports.AAPL?.status).toBe("success"));

    rerender({ t: ["AAPL", "MSFT"] });
    await waitFor(() => expect(result.current.reports.MSFT?.status).toBe("success"));

    // AAPL fetched once, MSFT once.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
