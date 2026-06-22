import { memo } from "react";

import { changeDirection, formatNumber, formatPercent, formatPrice } from "../lib/format";
import type { ReportState } from "../hooks/useStockReports";
import type { TrendVerdict } from "../types/stock";

interface ComparisonTableProps {
  tickers: string[];
  reports: Record<string, ReportState>;
  activeTicker: string | null;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}

const TREND_TEXT: Record<TrendVerdict, string> = {
  uptrend: "上昇基調",
  downtrend: "下落基調",
  sideways: "横ばい",
  unknown: "—",
};

/**
 * Memoized: with the callbacks below stabilized in `App` (useCallback) and the
 * selection arrays stable, the table only re-renders when the reports map, the
 * selection or the active ticker actually change — not on unrelated state churn.
 */
export const ComparisonTable = memo(function ComparisonTable({
  tickers,
  reports,
  activeTicker,
  onSelect,
  onRemove,
}: ComparisonTableProps) {
  return (
    <div className="table-wrap">
      <table className="comparison-table">
        <caption className="sr-only">選択した銘柄の主要指標の比較表</caption>
        <thead>
          <tr>
            <th scope="col">銘柄</th>
            <th scope="col">現在値</th>
            <th scope="col">期間騰落率</th>
            <th scope="col">RSI(14)</th>
            <th scope="col">年率ボラ</th>
            <th scope="col">最大下落率</th>
            <th scope="col">トレンド</th>
            <th scope="col">スコア</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {tickers.map((ticker) => {
            const state = reports[ticker];
            const isActive = ticker === activeTicker;
            const removeButton = (
              <button
                type="button"
                className="row-remove"
                aria-label={`${ticker} を一覧から削除`}
                onClick={() => onRemove(ticker)}
              >
                削除
              </button>
            );

            // No entry yet = the user has not selected this ticker, so it was
            // never fetched. Show "未取得" rather than triggering a request.
            if (!state) {
              return (
                <tr key={ticker} className={isActive ? "is-active" : undefined}>
                  <td>
                    <button type="button" className="row-link" onClick={() => onSelect(ticker)}>
                      {ticker}
                    </button>
                  </td>
                  <td colSpan={7} className="muted">
                    未取得
                  </td>
                  <td>{removeButton}</td>
                </tr>
              );
            }

            if (state.status === "loading") {
              return (
                <tr key={ticker} className={isActive ? "is-active" : undefined}>
                  <td>{ticker}</td>
                  <td colSpan={7} className="muted">
                    読み込み中…
                  </td>
                  <td>{removeButton}</td>
                </tr>
              );
            }

            if (state.status === "error") {
              // Keep rows terse: the full provider message (e.g. a rate-limit
              // notice) is shown ONCE in the panel above, never repeated per row.
              return (
                <tr key={ticker} className={isActive ? "is-active" : undefined}>
                  <td>
                    <button type="button" className="row-link" onClick={() => onSelect(ticker)}>
                      {ticker}
                    </button>
                  </td>
                  <td colSpan={7} className="state--error">
                    取得できませんでした
                  </td>
                  <td>{removeButton}</td>
                </tr>
              );
            }

            const { metrics, analysis } = state.report;
            return (
              <tr key={ticker} className={isActive ? "is-active" : undefined}>
                <td>
                  <button type="button" className="row-link" onClick={() => onSelect(ticker)}>
                    {ticker}
                  </button>
                </td>
                <td>{formatPrice(metrics.currentPrice, state.report.currency)}</td>
                <td className={`value-${changeDirection(metrics.periodReturnPercent)}`}>
                  {formatPercent(metrics.periodReturnPercent)}
                </td>
                <td>{formatNumber(metrics.rsi14, 1)}</td>
                <td>{formatPercent(metrics.annualizedVolatilityPercent)}</td>
                <td>{formatPercent(metrics.maxDrawdownPercent)}</td>
                <td>{TREND_TEXT[analysis.trend]}</td>
                <td>{analysis.score ?? "—"}</td>
                <td>{removeButton}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
