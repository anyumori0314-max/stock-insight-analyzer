import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnalysisPanel } from "./components/AnalysisPanel";
import { ComparisonTable } from "./components/ComparisonTable";
import { DataStatus } from "./components/DataStatus";
import { Disclaimer } from "./components/Disclaimer";
import { Header } from "./components/Header";
import { MetricsPanel } from "./components/MetricsPanel";
import { RangeSwitch } from "./components/RangeSwitch";
import { Sidebar } from "./components/Sidebar";
import { TickerTabs } from "./components/TickerTabs";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { reportKey, useStockReports, type ReportState } from "./hooks/useStockReports";
import { buildComparisonCsv } from "./lib/comparisonExport";
import { downloadTextFile } from "./lib/csv";
import { rangeLabel, type StockRange } from "./lib/ranges";
import { FANG_PLUS_PRESETS } from "./lib/tickers";
import {
  MAX_WATCHLIST_TICKERS,
  loadWatchlistState,
  parseImportedWatchlist,
  saveWatchlistState,
  serializeWatchlist,
} from "./lib/watchlistStorage";

const PRESET_SYMBOLS = new Set(FANG_PLUS_PRESETS.map((preset) => preset.symbol));

// Recharts is the heaviest dependency and is not needed for the first paint
// (the empty-state prompt) or for the metrics. Load the chart lazily so Recharts
// ships in its own chunk fetched only when a chart first renders. A render-time
// failure here is caught by the top-level ErrorBoundary.
const PriceChart = lazy(() =>
  import("./components/PriceChart").then((m) => ({ default: m.PriceChart }))
);

const PANEL_ID = "stock-panel";

function App() {
  // Restore the persisted watchlist (Phase 17) once, on first render. An empty /
  // missing / corrupt store yields the clean default, so a fresh visitor still
  // starts empty and the initial render makes ZERO API calls.
  const initialWatchlist = useMemo(() => loadWatchlistState(), []);
  const [selected, setSelected] = useState<string[]>(initialWatchlist.watchlist);
  const [activeTicker, setActiveTicker] = useState<string | null>(initialWatchlist.selectedTicker);
  // The analysis window. Each (ticker, range) pair is fetched and cached
  // independently, so switching the window re-uses a previously loaded pair
  // instead of re-calling the API.
  const [range, setRange] = useState<StockRange>(initialWatchlist.selectedRange);
  const { reports, pending, request, refetch, forget } = useStockReports();

  // Visually-hidden announcement for watchlist outcomes (save failure / import /
  // reset). Distinct from the main panel's live region below.
  const [watchlistStatus, setWatchlistStatus] = useState("");
  // Polite status for the comparison CSV export outcome.
  const [comparisonStatus, setComparisonStatus] = useState("");

  const errorRef = useRef<HTMLDivElement>(null);
  const lastErrorFocusRef = useRef<string>("");

  // Persist the watchlist whenever it changes. A write failure (quota / disabled
  // storage) only announces a notice — the app keeps working from memory.
  useEffect(() => {
    const result = saveWatchlistState({
      watchlist: selected,
      selectedTicker: activeTicker,
      selectedRange: range,
    });
    if (!result.ok) {
      setWatchlistStatus(
        result.reason === "quota"
          ? "保存容量の上限によりウォッチリストを保存できませんでした（変更はこのセッションのみ有効です）。"
          : "ウォッチリストを保存できませんでした（変更はこのセッションのみ有効です）。"
      );
    }
  }, [selected, activeTicker, range]);

  // Keep the active ticker valid as the selection changes.
  useEffect(() => {
    if (selected.length === 0) {
      if (activeTicker !== null) setActiveTicker(null);
      return;
    }
    if (!activeTicker || !selected.includes(activeTicker)) {
      setActiveTicker(selected[0]);
    }
  }, [selected, activeTicker]);

  // Lazily fetch the active (ticker, range) pair — and only it. Preset/tab/add
  // and the window selector all flow through `activeTicker` + `range`, so exactly
  // one pair is requested per change. `request` is a no-op when that pair is
  // already loaded / in flight, so StrictMode's double-invoke, re-selecting a
  // ticker, and switching back to an already-loaded window issue no extra calls.
  useEffect(() => {
    if (activeTicker) {
      request(activeTicker, range);
    }
  }, [activeTicker, range, request]);

  const activeKey = activeTicker ? reportKey(activeTicker, range) : null;
  const activeState = activeKey ? reports[activeKey] : undefined;
  const activeStatus = activeState?.status;
  const activePending = activeKey ? Boolean(pending[activeKey]) : false;

  // Focus is moved ONLY on an error transition — to the error region (role=alert)
  // so keyboard / screen-reader users are taken straight to the message + retry,
  // once per transition. Loading and success do NOT steal focus: it stays on the
  // control the user activated (a range toggle or a ticker tab), so switching the
  // window does not yank focus to a generic heading. Those non-error states are
  // announced through the polite live region below instead.
  useEffect(() => {
    if (!activeTicker || activeStatus !== "error") {
      return;
    }
    const key = `${activeTicker}:${range}:error`;
    if (lastErrorFocusRef.current !== key) {
      lastErrorFocusRef.current = key;
      errorRef.current?.focus();
    }
  }, [activeTicker, range, activeStatus]);

  // Polite status announcement for window/ticker changes. It names BOTH the
  // ticker and the window so a screen-reader user knows exactly what changed when
  // they switch the period (start + success). Errors are announced by the
  // assertive role="alert" region, so the polite region stays quiet for them to
  // avoid a double announcement.
  const liveMessage = !activeTicker
    ? ""
    : !activeState || activeState.status === "loading"
      ? `${activeTicker} の ${rangeLabel(range)} を読み込み中です。`
      : activeState.status === "success"
        ? `${activeTicker} の ${rangeLabel(range)} を表示しました。`
        : "";

  // Mirrors of the watchlist state for the stable ([]-deps) handlers below, so
  // they read the latest values without being recreated on every change.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const activeTickerRef = useRef(activeTicker);
  activeTickerRef.current = activeTicker;
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // Stable handler identities so the memoized Sidebar / ComparisonTable / tabs do
  // not re-render on unrelated state changes. setSelected / setActiveTicker /
  // forget are all stable, so these never need to be recreated.
  const handleAdd = useCallback((ticker: string) => {
    const current = selectedRef.current;
    if (current.includes(ticker)) {
      setActiveTicker(ticker);
      return;
    }
    // Enforce the max-entries cap; announce rather than silently dropping.
    if (current.length >= MAX_WATCHLIST_TICKERS) {
      setWatchlistStatus(`登録できる銘柄は最大${MAX_WATCHLIST_TICKERS}件です。追加できませんでした。`);
      return;
    }
    setSelected((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
    setActiveTicker(ticker);
    setWatchlistStatus("");
  }, []);

  const handleRemove = useCallback(
    (ticker: string) => {
      setSelected((prev) => prev.filter((item) => item !== ticker));
      // Abort any in-flight request (across ALL windows) and drop kept state so a
      // late response cannot revive the removed ticker (and a re-add re-fetches).
      forget(ticker);
    },
    [forget]
  );

  // Reorder the watchlist (keyboard-friendly move up/down); persisted by the
  // effect above. The active ticker is unaffected by a reorder.
  const handleMove = useCallback((ticker: string, direction: "up" | "down") => {
    setSelected((prev) => {
      const index = prev.indexOf(ticker);
      if (index === -1) return prev;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleResetWatchlist = useCallback(() => {
    selectedRef.current.forEach((ticker) => forget(ticker));
    setSelected([]);
    setActiveTicker(null);
    setWatchlistStatus("ウォッチリストを初期化しました。");
  }, [forget]);

  const handleExportWatchlist = useCallback(() => {
    const json = serializeWatchlist({
      watchlist: selectedRef.current,
      selectedTicker: activeTickerRef.current,
      selectedRange: rangeRef.current,
    });
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "stock-insight-watchlist.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setWatchlistStatus("ウォッチリストをエクスポートしました。");
    } catch {
      setWatchlistStatus("エクスポートに失敗しました。");
    }
  }, []);

  const handleImportWatchlist = useCallback(
    (jsonText: string) => {
      const result = parseImportedWatchlist(jsonText);
      if (!result.ok) {
        setWatchlistStatus(`インポートに失敗しました：${result.error}`);
        return;
      }
      // Drop any in-flight/kept reports for tickers no longer in the list.
      selectedRef.current.forEach((ticker) => {
        if (!result.state.watchlist.includes(ticker)) forget(ticker);
      });
      setSelected(result.state.watchlist);
      setActiveTicker(result.state.selectedTicker);
      setRange(result.state.selectedRange);
      setWatchlistStatus(`ウォッチリストをインポートしました（${result.state.watchlist.length}件）。`);
    },
    [forget]
  );

  // Per-ticker view of the CURRENTLY selected window for the comparison table.
  // Only (ticker, range) pairs the user has actually visited have an entry; the
  // rest render as 未取得 — the table never triggers a fetch on its own.
  const rangeReports = useMemo(() => {
    const view: Record<string, ReportState> = {};
    for (const ticker of selected) {
      const state = reports[reportKey(ticker, range)];
      if (state) view[ticker] = state;
    }
    return view;
  }, [selected, reports, range]);

  // Export the current comparison (selected tickers in the active window) as CSV.
  // The builder applies RFC-4180 quoting AND CSV formula-injection neutralization
  // to every field. A download failure (non-DOM / blocked) announces a notice.
  const handleExportComparison = useCallback(() => {
    const csv = buildComparisonCsv(selected, rangeReports, range);
    const filename = `stock-comparison-${range}.csv`;
    const ok = downloadTextFile(filename, csv);
    setComparisonStatus(
      ok ? "比較表をCSVでエクスポートしました。" : "CSVのエクスポートに失敗しました。"
    );
  }, [selected, rangeReports, range]);

  return (
    <div className="app-shell">
      <Header />

      <div className="app-body">
        <Sidebar selected={selected} onAdd={handleAdd} onRemove={handleRemove}>
          <WatchlistPanel
            watchlist={selected}
            presets={PRESET_SYMBOLS}
            activeTicker={activeTicker}
            statusMessage={watchlistStatus}
            onSelect={setActiveTicker}
            onRemove={handleRemove}
            onMove={handleMove}
            onReset={handleResetWatchlist}
            onExport={handleExportWatchlist}
            onImport={handleImportWatchlist}
          />
        </Sidebar>

        <main className="main">
          {selected.length === 0 ? (
            <section className="card">
              <div className="empty-hint">
                <p>銘柄を選択すると株価データを取得します。</p>
                <p className="muted">
                  左のFANG+参考プリセットを選ぶか、ティッカーを入力して分析を開始してください。
                </p>
              </div>
            </section>
          ) : (
            <>
              <section className="card">
                <div className="card__header">
                  <h2 className="card__title">価格チャートと指標</h2>
                  <span className="muted">タブで銘柄切替（←→キーで移動）</span>
                </div>

                <TickerTabs
                  tickers={selected}
                  activeTicker={activeTicker}
                  onSelect={setActiveTicker}
                  panelId={PANEL_ID}
                />

                <RangeSwitch value={range} onChange={setRange} />

                {/* Polite, visually-hidden announcement of window/ticker changes
                    (start + success). Always mounted while a ticker is selected so
                    assistive tech reliably hears subsequent updates. */}
                <div className="sr-only" role="status" aria-live="polite">
                  {liveMessage}
                </div>

                <div
                  id={PANEL_ID}
                  role="tabpanel"
                  aria-labelledby={activeTicker ? `tab-${activeTicker}` : undefined}
                  tabIndex={0}
                  className="tabpanel"
                >
                  {!activeState || activeState.status === "loading" ? (
                    <div className="state" role="status" aria-live="polite">
                      <span className="spinner" aria-hidden="true" />
                      <span> 読み込み中…</span>
                    </div>
                  ) : activeState.status === "error" ? (
                    <div className="state state--error" role="alert" ref={errorRef} tabIndex={-1}>
                      <p>{activeState.message}</p>
                      {activeTicker && (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => refetch(activeTicker, range)}
                          disabled={activePending}
                          aria-disabled={activePending}
                        >
                          {activePending ? "再試行中…" : "再試行"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {activeState.report.source === "mock" && (
                        <p className="state state--mock" role="status">
                          開発用モックデータを表示しています。
                        </p>
                      )}
                      <DataStatus report={activeState.report} />
                      <Suspense
                        fallback={
                          <div className="state" role="status" aria-live="polite">
                            <span className="spinner" aria-hidden="true" />
                            <span> チャートを準備中…</span>
                          </div>
                        }
                      >
                        <PriceChart
                          bars={activeState.report.series}
                          priceBasis={activeState.report.priceBasis}
                          currency={activeState.report.currency}
                          range={activeState.report.range}
                          trend={activeState.report.analysis.trend}
                        />
                      </Suspense>
                      <div style={{ marginTop: "var(--space-4)" }}>
                        <MetricsPanel
                          metrics={activeState.report.metrics}
                          currency={activeState.report.currency}
                        />
                      </div>
                      {activeState.report.warnings.length > 0 && (
                        <ul className="warning-list">
                          {activeState.report.warnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              </section>

              {activeState?.status === "success" && (
                <section className="card">
                  <div className="card__header">
                    <h2 className="card__title">分析コメント（{activeState.report.ticker}）</h2>
                  </div>
                  <AnalysisPanel analysis={activeState.report.analysis} />
                </section>
              )}

              <section className="card">
                <div className="card__header">
                  <h2 className="card__title">銘柄比較</h2>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={handleExportComparison}
                  >
                    CSVエクスポート
                  </button>
                </div>
                <div className="sr-only" role="status" aria-live="polite">
                  {comparisonStatus}
                </div>
                <ComparisonTable
                  tickers={selected}
                  reports={rangeReports}
                  activeTicker={activeTicker}
                  onSelect={setActiveTicker}
                  onRemove={handleRemove}
                />
              </section>
            </>
          )}
        </main>
      </div>

      <Disclaimer />
    </div>
  );
}

export default App;
