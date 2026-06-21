import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchStockReport, StockApiError } from "../lib/api";
import type { StockReport } from "../types/stock";

export type ReportState =
  | { status: "loading" }
  | { status: "success"; report: StockReport }
  | { status: "error"; message: string; code: string };

export interface UseStockReportsResult {
  reports: Record<string, ReportState>;
  /** Forces a re-fetch of a single ticker (bypasses the kept success state). */
  refetch: (ticker: string) => void;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Fetches analyzed reports for a set of tickers, exposing per-ticker
 * loading/success/error state.
 *
 * Stale-response safety:
 *  - in-flight requests are aborted on cleanup (selection change / unmount);
 *  - a resolved/rejected request is ignored if its AbortController was aborted,
 *    if the component unmounted, or if the ticker is no longer selected — so a
 *    late AAPL response can never overwrite MSFT, nor revive a removed ticker;
 *  - genuine aborts never surface as user-facing errors.
 */
export function useStockReports(tickers: string[]): UseStockReportsResult {
  const [reports, setReports] = useState<Record<string, ReportState>>({});
  const [reloadKey, setReloadKey] = useState(0);

  // Refs let the effect read the latest values without re-subscribing (which
  // would loop) and without acting on stale closures.
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const selectedRef = useRef(tickers);
  selectedRef.current = tickers;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectedKey = useMemo(() => [...tickers].sort().join(","), [tickers]);

  useEffect(() => {
    const controllers: AbortController[] = [];

    // Prune tickers no longer requested; preserve existing entries.
    setReports((prev) => {
      const next: Record<string, ReportState> = {};
      for (const ticker of tickers) {
        next[ticker] = prev[ticker] ?? { status: "loading" };
      }
      return next;
    });

    for (const ticker of tickers) {
      const existing = reportsRef.current[ticker];
      if (existing && existing.status === "success") {
        continue; // keep cached result
      }

      const controller = new AbortController();
      controllers.push(controller);
      setReports((prev) => ({ ...prev, [ticker]: { status: "loading" } }));

      const isStale = () =>
        !mountedRef.current ||
        controller.signal.aborted ||
        !selectedRef.current.includes(ticker);

      fetchStockReport(ticker, controller.signal)
        .then((report) => {
          if (isStale()) return;
          setReports((prev) =>
            ticker in prev ? { ...prev, [ticker]: { status: "success", report } } : prev
          );
        })
        .catch((err: unknown) => {
          if (isStale() || isAbortError(err)) return;
          const message =
            err instanceof StockApiError ? err.message : "予期しないエラーが発生しました。";
          const code = err instanceof StockApiError ? err.code : "UNKNOWN";
          setReports((prev) =>
            ticker in prev ? { ...prev, [ticker]: { status: "error", message, code } } : prev
          );
        });
    }

    return () => {
      controllers.forEach((controller) => controller.abort());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, reloadKey]);

  const refetch = useCallback((ticker: string) => {
    setReports((prev) => {
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
    setReloadKey((value) => value + 1);
  }, []);

  return { reports, refetch };
}
