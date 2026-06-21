import { useEffect, useRef, useState } from "react";

import { AnalysisPanel } from "./components/AnalysisPanel";
import { ComparisonTable } from "./components/ComparisonTable";
import { Disclaimer } from "./components/Disclaimer";
import { Header } from "./components/Header";
import { MetricsPanel } from "./components/MetricsPanel";
import { PriceChart } from "./components/PriceChart";
import { Sidebar } from "./components/Sidebar";
import { TickerTabs } from "./components/TickerTabs";
import { useStockReports } from "./hooks/useStockReports";

const INITIAL_TICKERS = ["AAPL", "MSFT", "NVDA"];
const PANEL_ID = "stock-panel";

function App() {
  const [selected, setSelected] = useState<string[]>(INITIAL_TICKERS);
  const [activeTicker, setActiveTicker] = useState<string | null>(INITIAL_TICKERS[0]);
  const { reports, refetch } = useStockReports(selected);

  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedRef = useRef<string>("");

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

  const activeState = activeTicker ? reports[activeTicker] : undefined;
  const activeStatus = activeState?.status;

  // Move focus to the panel heading when the active ticker finishes loading
  // (success or error), once per transition, so keyboard/SR users land on the
  // fresh content instead of staying on the control they activated.
  useEffect(() => {
    if (!activeTicker || (activeStatus !== "success" && activeStatus !== "error")) {
      return;
    }
    const key = `${activeTicker}:${activeStatus}`;
    if (lastFocusedRef.current !== key) {
      lastFocusedRef.current = key;
      panelHeadingRef.current?.focus();
    }
  }, [activeTicker, activeStatus]);

  function handleAdd(ticker: string) {
    setSelected((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
    setActiveTicker(ticker);
  }

  function handleRemove(ticker: string) {
    setSelected((prev) => prev.filter((item) => item !== ticker));
  }

  return (
    <div className="app-shell">
      <Header />

      <div className="app-body">
        <Sidebar selected={selected} onAdd={handleAdd} onRemove={handleRemove} />

        <main className="main">
          {selected.length === 0 ? (
            <section className="card">
              <div className="empty-hint">
                左のFANG+参考プリセットを選ぶか、ティッカーを入力して分析を開始してください。
              </div>
            </section>
          ) : (
            <>
              <section className="card">
                <div className="card__header">
                  <h2 className="card__title" ref={panelHeadingRef} tabIndex={-1}>
                    価格チャートと指標
                  </h2>
                  <span className="muted">タブで銘柄切替（←→キーで移動）</span>
                </div>

                <TickerTabs
                  tickers={selected}
                  activeTicker={activeTicker}
                  onSelect={setActiveTicker}
                  panelId={PANEL_ID}
                />

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
                    <div className="state state--error" role="alert">
                      <p>{activeState.message}</p>
                      {activeTicker && (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => refetch(activeTicker)}
                        >
                          再試行
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="muted">
                        {activeState.report.ticker}・最終更新 {activeState.report.lastRefreshed ?? "—"}
                        （{activeState.report.timezone ?? "—"}）
                      </p>
                      <PriceChart
                        bars={activeState.report.series}
                        priceBasis={activeState.report.priceBasis}
                        currency={activeState.report.currency}
                        range={activeState.report.range}
                        trend={activeState.report.analysis.trend}
                      />
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
                  reports={reports}
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
