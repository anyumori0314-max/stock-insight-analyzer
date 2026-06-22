import type { StockPricePoint } from "../types/stock";

/**
 * Hard cap on the number of points actually handed to the chart renderer.
 *
 * The provider series is already bounded server-side (`ALPHA_VANTAGE_MAX_POINTS`,
 * ~100–120 daily bars) and the widest supported UI range (3m ≈ 63 bars) sits well
 * under this limit, so normal data is NEVER down-sampled. This is purely a
 * second, render-side guard so an unexpectedly long series can never freeze the
 * UI thread inside Recharts. It does NOT change or weaken the server-side cap.
 */
export const MAX_CHART_POINTS = 400;

/**
 * Returns chart-ready points: at most `cap`, evenly strided, and ALWAYS keeping
 * the most recent bar so the latest price is never dropped.
 *
 * - When the series is within `cap`, the SAME array reference is returned (no
 *   copy, no sort, no mutation) — the input is treated as read-only.
 * - Values are already finite-or-null by the report contract, so no numeric
 *   sanitization is needed; Recharts renders `null` as a line gap.
 */
export function prepareChartData(
  bars: StockPricePoint[],
  cap: number = MAX_CHART_POINTS
): StockPricePoint[] {
  if (bars.length <= cap) {
    return bars;
  }
  const stride = Math.ceil(bars.length / cap);
  const out: StockPricePoint[] = [];
  for (let i = 0; i < bars.length; i += stride) {
    out.push(bars[i]);
  }
  const last = bars[bars.length - 1];
  if (out[out.length - 1] !== last) {
    out.push(last);
  }
  return out;
}
