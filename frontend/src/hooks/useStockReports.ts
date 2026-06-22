import { useCallback, useEffect, useRef, useState } from "react";

import { fetchStockReport, StockApiError } from "../lib/api";
import type { StockRange } from "../lib/ranges";
import type { StockReport } from "../types/stock";

export type ReportState =
  | { status: "loading" }
  | { status: "success"; report: StockReport }
  | { status: "error"; message: string; code: string };

/** Store key for a (ticker, range) pair. Distinct ranges are distinct entries. */
export function reportKey(ticker: string, range: StockRange): string {
  return `${ticker}:${range}`;
}

export interface UseStockReportsResult {
  /** Keyed by `reportKey(ticker, range)` so each window is tracked separately. */
  reports: Record<string, ReportState>;
  /** Keys with an outbound request currently in flight (UI: disable/relabel). */
  pending: Record<string, boolean>;
  /**
   * Lazily fetches ONE (ticker, range), on demand. No-op if it is already loaded
   * / errored / in flight — selecting never silently re-fetches or auto-retries
   * (that is what `refetch` is for). This is the only path that triggers a
   * network call, so nothing is fetched until the user picks a ticker/range.
   */
  request: (ticker: string, range: StockRange) => void;
  /** Explicit user-driven re-fetch of a single (ticker, range). */
  refetch: (ticker: string, range: StockRange) => void;
  /**
   * Drops a ticker entirely (ALL of its ranges): aborts any in-flight requests,
   * invalidates their generations so a late response can never revive them, and
   * clears their report / pending state.
   */
  forget: (ticker: string) => void;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * On-demand, per-(ticker, range) report store.
 *
 * Same lifecycle guarantees as before, now keyed by `ticker:range` so changing
 * the window fetches (and caches) independently of other windows:
 *  - NOTHING is fetched on mount or on selection changes; a request happens only
 *    via {@link UseStockReportsResult.request} / `refetch` for one key.
 *  - In-flight de-duplication per key (StrictMode double-invoke / double-click
 *    safe — exactly one call per key goes out).
 *  - No auto-retry: a failed key stays failed until the user hits retry.
 *  - Results persist: an already-fetched key serves its kept state; switching
 *    back to a previously loaded range never re-calls the API.
 *  - Lifecycle-safe: removing a ticker aborts every in-flight range and bumps
 *    per-key generations; unmounting aborts everything. A response applies only
 *    when it is still the latest, non-aborted request and the component is
 *    mounted, so a late/forgotten/superseded response can neither revive removed
 *    state nor warn about updating an unmounted component.
 */
export function useStockReports(): UseStockReportsResult {
  const [reports, setReports] = useState<Record<string, ReportState>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  const controllersRef = useRef(new Map<string, AbortController>());
  const generationRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  /** Bumps and returns the key's generation, invalidating older requests. */
  const bumpGeneration = (key: string): number => {
    const next = (generationRef.current.get(key) ?? 0) + 1;
    generationRef.current.set(key, next);
    return next;
  };

  const run = useCallback((ticker: string, range: StockRange, force: boolean) => {
    const key = reportKey(ticker, range);
    // Already fetching this key -> never send a duplicate request.
    if (controllersRef.current.has(key)) {
      return;
    }
    const existing = reportsRef.current[key];
    // Without `force`, an existing entry (loading/success/error) is left alone.
    if (!force && existing) {
      return;
    }

    const generation = bumpGeneration(key);
    const controller = new AbortController();
    controllersRef.current.set(key, controller);

    setPending((prev) => ({ ...prev, [key]: true }));
    // Show loading only for a first-time fetch; a forced retry keeps the previous
    // error/success visible (button disabled) instead of flashing a spinner.
    setReports((prev) => (prev[key] ? prev : { ...prev, [key]: { status: "loading" } }));

    const isStale = () =>
      !mountedRef.current ||
      controller.signal.aborted ||
      generationRef.current.get(key) !== generation;

    fetchStockReport(ticker, range, controller.signal)
      .then((report) => {
        if (isStale()) return;
        setReports((prev) => ({ ...prev, [key]: { status: "success", report } }));
      })
      .catch((err: unknown) => {
        if (isStale() || isAbortError(err)) return;
        const message =
          err instanceof StockApiError ? err.message : "予期しないエラーが発生しました。";
        const code = err instanceof StockApiError ? err.code : "UNKNOWN";
        setReports((prev) => ({ ...prev, [key]: { status: "error", message, code } }));
      })
      .finally(() => {
        if (controllersRef.current.get(key) === controller) {
          controllersRef.current.delete(key);
        }
        if (!mountedRef.current || generationRef.current.get(key) !== generation) {
          return;
        }
        setPending((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      });
  }, []);

  const request = useCallback((ticker: string, range: StockRange) => run(ticker, range, false), [run]);
  const refetch = useCallback((ticker: string, range: StockRange) => run(ticker, range, true), [run]);

  const forget = useCallback((ticker: string) => {
    const prefix = `${ticker}:`;
    // Collect every range-key belonging to this ticker.
    const keys = new Set<string>();
    controllersRef.current.forEach((_, k) => {
      if (k.startsWith(prefix)) keys.add(k);
    });
    Object.keys(reportsRef.current).forEach((k) => {
      if (k.startsWith(prefix)) keys.add(k);
    });

    keys.forEach((key) => {
      // Invalidate any in-flight request first so its pending settle is ignored.
      bumpGeneration(key);
      const controller = controllersRef.current.get(key);
      if (controller) {
        controller.abort();
        controllersRef.current.delete(key);
      }
    });

    setReports((prev) => {
      const next: Record<string, ReportState> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(prefix)) changed = true;
        else next[k] = v;
      }
      return changed ? next : prev;
    });
    setPending((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(prefix)) changed = true;
        else next[k] = v;
      }
      return changed ? next : prev;
    });
  }, []);

  return { reports, pending, request, refetch, forget };
}
