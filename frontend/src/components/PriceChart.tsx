import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  const currencyText = currency ?? "USD想定";
  return (
    `価格チャート要約：期間 ${range}（${first.date}〜${last.date}）、` +
    `価格基準 ${basisText}、通貨 ${currencyText}。` +
    `最新終値 ${formatPrice(last.close)}。トレンドは${TREND_TEXT[trend]}。`
  );
}

export function PriceChart(props: PriceChartProps) {
  const { bars } = props;
  const summary = buildSummary(props);

  if (bars.length === 0) {
    return <p className="muted">{summary}</p>;
  }

  return (
    <figure className="chart-figure">
      <figcaption className="chart-summary">{summary}</figcaption>
      {/* The SVG is decorative for assistive tech; the caption above conveys the data. */}
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={bars} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
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
              width={56}
              tickFormatter={(value: number) => `$${value.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#9aa6c4" }}
              formatter={(value: unknown) =>
                typeof value === "number" ? `$${value.toFixed(2)}` : String(value)
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="close" name="終値" stroke="#4f8cff" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sma20" name="SMA20" stroke="#2fbf71" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="sma50" name="SMA50" stroke="#f5b14c" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
