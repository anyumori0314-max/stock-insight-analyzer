import { memo, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { prepareChartData } from "../lib/chart";
import { formatPrice } from "../lib/format";
import type { StockPricePoint, TrendVerdict } from "../types/stock";

interface PriceChartProps {
  bars: StockPricePoint[];
  priceBasis: "close" | "adjusted";
  currency: string | null;
  range: string;
  trend: TrendVerdict;
}

const AXIS_COLOR = "#9aa6c4";
const GRID_COLOR = "#29335a";

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "#1c2540",
  border: "1px solid #29335a",
  borderRadius: 8,
  color: "#e6ebf5",
};

const TREND_TEXT: Record<TrendVerdict, string> = {
  uptrend: "上昇基調",
  downtrend: "下落基調",
  sideways: "横ばい",
  unknown: "判定不可",
};

/** The chart's series — single source of truth for the lines and the legend. */
const CHART_SERIES = [
  { key: "close", name: "終値", color: "#4f8cff", width: 2 },
  { key: "sma20", name: "SMA20", color: "#2fbf71", width: 1.5 },
  { key: "sma50", name: "SMA50", color: "#f5b14c", width: 1.5 },
] as const;

function formatDateTick(value: string): string {
  return value.length >= 10 ? value.slice(5).replace("-", "/") : value;
}

/** Builds a text summary so the chart is meaningful without the visual. */
function buildSummary(props: PriceChartProps): string {
  const { bars, priceBasis, currency, range, trend } = props;
  if (bars.length === 0) {
    return "表示できる価格データがありません。";
  }
  const first = bars[0];
  const last = bars[bars.length - 1];
  const basisText = priceBasis === "close" ? "終値（調整前）" : "調整後終値";
  const currencyText = currency ?? "不明";
  return (
    `価格チャート要約：期間 ${range}（${first.date}〜${last.date}）、` +
    `価格基準 ${basisText}、通貨 ${currencyText}。` +
    `最新終値 ${formatPrice(last.close, currency)}。トレンドは${TREND_TEXT[trend]}。`
  );
}

/**
 * Memoized so switching unrelated dashboard state (pending flags, other tickers)
 * never re-runs the relatively expensive Recharts render. It only re-renders when
 * its own props change. It is also lazy-loaded by `App` so Recharts is not in the
 * initial bundle.
 */
export const PriceChart = memo(function PriceChart(props: PriceChartProps) {
  const { bars, currency } = props;
  const summary = buildSummary(props);
  // Render-side guard against an unexpectedly long series; realistic data
  // (<= ~252 bars) passes through untouched (same reference).
  const data = useMemo(() => prepareChartData(bars), [bars]);

  if (bars.length === 0) {
    return <p className="muted">{summary}</p>;
  }

  return (
    <figure className="chart-figure">
      <figcaption className="chart-summary">{summary}</figcaption>
      {/* Accessible legend OUTSIDE the aria-hidden chart subtree, so the series
          mapping is conveyed to screen-reader and keyboard users (the Recharts
          legend lives inside the hidden SVG and is not announced). The color
          swatches are decorative; the text label carries the meaning. */}
      <ul className="chart-legend">
        {CHART_SERIES.map((s) => (
          <li key={s.key} className="chart-legend__item">
            <span
              className="chart-legend__swatch"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            {s.name}
          </li>
        ))}
      </ul>
      {/* The SVG is decorative for assistive tech; the caption above conveys the
          data. `accessibilityLayer={false}` keeps Recharts from emitting a
          tabIndex=0 / role="application" surface, so this aria-hidden subtree
          holds NO keyboard-focusable element (a hidden focus stop would strand
          keyboard users on an element screen readers cannot announce). */}
      <div className="chart-canvas" aria-hidden="true">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateTick}
              stroke={AXIS_COLOR}
              tick={{ fontSize: 12 }}
              minTickGap={28}
            />
            <YAxis
              stroke={AXIS_COLOR}
              tick={{ fontSize: 12 }}
              domain={["auto", "auto"]}
              width={64}
              tickFormatter={(value: number) => formatPrice(value, currency, 0)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#9aa6c4" }}
              formatter={(value: unknown) =>
                typeof value === "number" ? formatPrice(value, currency) : String(value)
              }
            />
            {CHART_SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={s.width}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
});
