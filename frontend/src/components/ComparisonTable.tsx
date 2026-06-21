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

export function ComparisonTable({
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

            if (!state || state.status === "loading") {
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
              return (
                <tr key={ticker} className={isActive ? "is-active" : undefined}>
                  <td>{ticker}</td>
                  <td colSpan={7} className="state--error">
                    {state.message}
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
                <td>{formatPrice(metrics.currentPrice)}</td>
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
}
