import { useCallback, useEffect, useRef, useState } from "react";

import { fetchStockReport, StockApiError } from "../lib/api";
import type { StockReport } from "../types/stock";

export type ReportState =
  | { status: "loading" }
  | { status: "success"; report: StockReport }
  | { status: "error"; message: string; code: string };

export interface UseStockReportsResult {
  reports: Record<string, ReportState>;
  /** Tickers with an outbound request currently in flight (UI: disable/relabel). */
  pending: Record<string, boolean>;
  /**
   * Lazily fetches ONE ticker, on demand. No-op if it is already loaded /
   * errored / in flight — selecting a ticker never silently re-fetches or
   * auto-retries (that is what `refetch` is for). This is the only path that
   * ever triggers a network call, so nothing is fetched until the user picks a
   * ticker.
   */
  request: (ticker: string) => void;
  /** Explicit user-driven re-fetch of a single ticker (the retry button). */
  refetch: (ticker: string) => void;
  /**
   * Drops a ticker: aborts any in-flight request, invalidates its generation so
   * a late response can never revive it, and clears its report / pending state.
   */
  forget: (ticker: string) => void;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * On-demand, per-ticker report store.
 *
 * Design goals (API-quota safety + request lifecycle correctness):
 *  - NOTHING is fetched on mount or on selection changes; a request happens only
 *    when {@link UseStockReportsResult.request} / `refetch` is called for one
 *    ticker, so the dashboard issues zero calls until the user selects a symbol.
 *  - In-flight de-duplication: a second `request`/`refetch` for a ticker already
 *    being fetched is ignored (also makes React StrictMode's double-invoke and
 *    rapid double-clicks safe — exactly one call goes out).
 *  - No auto-retry: a failed ticker stays failed until the user explicitly hits
 *    retry (`refetch`); errors never schedule timers or re-fetches.
 *  - Results persist: already-fetched tickers keep their data; re-selecting a
 *    ticker serves the kept success state instead of calling the API again.
 *  - Lifecycle-safe: removing a ticker aborts its request and bumps a per-ticker
 *    generation; unmounting aborts everything. A response is applied only when it
 *    is still the latest, non-aborted request and the component is mounted, so a
 *    late/forgotten/superseded response can neither revive removed state nor warn
 *    about updating an unmounted component.
 */
export function useStockReports(): UseStockReportsResult {
  const [reports, setReports] = useState<Record<string, ReportState>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  // controllersRef: active AbortController per ticker — the synchronous source of
  // truth for the in-flight check, and what we abort on removal / unmount.
  const controllersRef = useRef(new Map<string, AbortController>());
  // generationRef: monotonically increasing request id per ticker. Each request
  // captures its id; removal and newer requests bump it, so a stale settle (even
  // one we could not abort) is detected by an id mismatch and ignored.
  const generationRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      // Internal-ref cleanup: abort and drop every in-flight request. State is
      // intentionally NOT touched here (the component is going away).
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  /** Bumps and returns the ticker's generation, invalidating older requests. */
  const bumpGeneration = (ticker: string): number => {
    const next = (generationRef.current.get(ticker) ?? 0) + 1;
    generationRef.current.set(ticker, next);
    return next;
  };

  const run = useCallback((ticker: string, force: boolean) => {
    // Already fetching this ticker -> never send a duplicate request.
    if (controllersRef.current.has(ticker)) {
      return;
    }
    const existing = reportsRef.current[ticker];
    // Without `force`, an existing entry (loading/success/error) is left alone:
    // selecting a ticker prefers the cache and never auto-retries an error.
    if (!force && existing) {
      return;
    }

    const generation = bumpGeneration(ticker);
    const controller = new AbortController();
    controllersRef.current.set(ticker, controller);

    setPending((prev) => ({ ...prev, [ticker]: true }));
    // Show the loading state only for a first-time fetch; a forced retry keeps
    // the previous error/success visible (with the button disabled) instead of
    // flashing a full-panel spinner.
    setReports((prev) => (prev[ticker] ? prev : { ...prev, [ticker]: { status: "loading" } }));

    // Stale if the component unmounted, this request was aborted, or a newer
    // request / a removal bumped this ticker's generation.
    const isStale = () =>
      !mountedRef.current ||
      controller.signal.aborted ||
      generationRef.current.get(ticker) !== generation;

    fetchStockReport(ticker, controller.signal)
      .then((report) => {
        if (isStale()) return;
        setReports((prev) => ({ ...prev, [ticker]: { status: "success", report } }));
      })
      .catch((err: unknown) => {
        if (isStale() || isAbortError(err)) return;
        const message =
          err instanceof StockApiError ? err.message : "予期しないエラーが発生しました。";
        const code = err instanceof StockApiError ? err.code : "UNKNOWN";
        setReports((prev) => ({ ...prev, [ticker]: { status: "error", message, code } }));
      })
      .finally(() => {
        // Internal-ref cleanup runs regardless of mount state, but only if THIS
        // request still owns the slot (a newer request may have replaced it).
        if (controllersRef.current.get(ticker) === controller) {
          controllersRef.current.delete(ticker);
        }
        // State update is suppressed after unmount and for superseded requests.
        if (!mountedRef.current || generationRef.current.get(ticker) !== generation) {
          return;
        }
        setPending((prev) => {
          if (!prev[ticker]) return prev;
          const next = { ...prev };
          delete next[ticker];
          return next;
        });
      });
  }, []);

  const request = useCallback((ticker: string) => run(ticker, false), [run]);
  const refetch = useCallback((ticker: string) => run(ticker, true), [run]);

  const forget = useCallback((ticker: string) => {
    // Invalidate any in-flight request first so its pending settle is ignored.
    bumpGeneration(ticker);
    const controller = controllersRef.current.get(ticker);
    if (controller) {
      controller.abort();
      controllersRef.current.delete(ticker);
    }
    setReports((prev) => {
      if (!(ticker in prev)) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
    setPending((prev) => {
      if (!prev[ticker]) return prev;
      const next = { ...prev };
      delete next[ticker];
      return next;
    });
  }, []);

  return { reports, pending, request, refetch, forget };
}
