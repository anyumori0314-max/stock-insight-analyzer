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
import { reportKey, useStockReports, type ReportState } from "./hooks/useStockReports";
import { DEFAULT_RANGE, rangeLabel, type StockRange } from "./lib/ranges";

// Recharts is the heaviest dependency and is not needed for the first paint
// (the empty-state prompt) or for the metrics. Load the chart lazily so Recharts
// ships in its own chunk fetched only when a chart first renders. A render-time
// failure here is caught by the top-level ErrorBoundary.
const PriceChart = lazy(() =>
  import("./components/PriceChart").then((m) => ({ default: m.PriceChart }))
);

const PANEL_ID = "stock-panel";

function App() {
  // Start empty: nothing is selected and nothing is fetched until the user picks
  // a ticker, so the initial render makes ZERO API calls.
  const [selected, setSelected] = useState<string[]>([]);
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  // The analysis window. Each (ticker, range) pair is fetched and cached
  // independently, so switching the window re-uses a previously loaded pair
  // instead of re-calling the API.
  const [range, setRange] = useState<StockRange>(DEFAULT_RANGE);
  const { reports, pending, request, refetch, forget } = useStockReports();

  const errorRef = useRef<HTMLDivElement>(null);
  const lastErrorFocusRef = useRef<string>("");

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

  // Stable handler identities so the memoized Sidebar / ComparisonTable / tabs do
  // not re-render on unrelated state changes. setSelected / setActiveTicker /
  // forget are all stable, so these never need to be recreated.
  const handleAdd = useCallback((ticker: string) => {
    setSelected((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
    setActiveTicker(ticker);
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

  return (
    <div className="app-shell">
      <Header />

      <div className="app-body">
        <Sidebar selected={selected} onAdd={handleAdd} onRemove={handleRemove} />

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
