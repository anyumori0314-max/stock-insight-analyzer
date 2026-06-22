import { memo } from "react";

import {
  changeDirection,
  directionLabel,
  directionSymbol,
  formatNumber,
  formatPercent,
  formatPrice,
} from "../lib/format";
import type { StockMetrics } from "../types/stock";

interface MetricsPanelProps {
  metrics: StockMetrics;
  currency: string | null;
}

function MetricCard({
  label,
  value,
  direction,
  srLabel,
}: {
  label: string;
  value: string;
  direction?: "up" | "down" | "flat";
  srLabel?: string;
}) {
  const valueClass = direction ? `metric-card__value value-${direction}` : "metric-card__value";
  return (
    <div className="metric-card">
      <div className="metric-card__label">{label}</div>
      <div className={valueClass}>
        {value}
        {srLabel ? <span className="sr-only"> {srLabel}</span> : null}
      </div>
    </div>
  );
}

export const MetricsPanel = memo(function MetricsPanel({ metrics, currency }: MetricsPanelProps) {
  // No currency from TIME_SERIES_DAILY -> say so rather than implying USD.
  const currencyNote = currency ? `（${currency}）` : "（通貨不明 / raw close）";

  const dcDir = changeDirection(metrics.dailyChange);
  const dailyChangeValue =
    metrics.dailyChange === null
      ? "—"
      : `${directionSymbol(dcDir)} ${formatNumber(Math.abs(metrics.dailyChange))} (${formatPercent(
          metrics.dailyChangePercent
        )})`;

  const prDir = changeDirection(metrics.periodReturnPercent);

  return (
    <div className="metrics-grid">
      <MetricCard label={`現在値 ${currencyNote}`} value={formatPrice(metrics.currentPrice, currency)} />
      <MetricCard
        label="前日比"
        value={dailyChangeValue}
        direction={dcDir}
        srLabel={metrics.dailyChange === null ? undefined : directionLabel(dcDir)}
      />
      <MetricCard
        label="期間騰落率"
        value={formatPercent(metrics.periodReturnPercent)}
        direction={prDir}
        srLabel={metrics.periodReturnPercent === null ? undefined : directionLabel(prDir)}
      />
      <MetricCard label="移動平均 (20日)" value={formatPrice(metrics.sma20, currency)} />
      <MetricCard label="移動平均 (50日)" value={formatPrice(metrics.sma50, currency)} />
      <MetricCard label="RSI (14日)" value={formatNumber(metrics.rsi14, 1)} />
      <MetricCard
        label="年率ボラティリティ"
        value={formatPercent(metrics.annualizedVolatilityPercent)}
      />
      <MetricCard label="最大下落率" value={formatPercent(metrics.maxDrawdownPercent)} />
    </div>
  );
});
