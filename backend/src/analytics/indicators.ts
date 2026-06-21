/**
 * Pure technical-indicator math (Phase 4).
 *
 * Every function is a side-effect-free transformation over an array of closing
 * prices ordered oldest -> newest. When there is not enough data to produce a
 * meaningful value — OR when the result is not a finite number (overflow to
 * Infinity, NaN from a degenerate division) — the function returns `null`
 * rather than guessing or leaking a value that `JSON.stringify` would silently
 * coerce to `null`.
 *
 * These are deliberately framework-free and provider-free so they can be unit
 * tested in isolation.
 */

import { finiteOrNull } from "../utils/number";

/** Number of trading days per year, used to annualize daily volatility. */
export const TRADING_DAYS_PER_YEAR = 252;

/** Default RSI look-back window. */
export const RSI_PERIOD = 14;

/**
 * Simple percentage return across the whole window: from the first close to the
 * last. Returns `null` if there are fewer than two points or the base is zero.
 */
export function periodReturnPct(closes: number[]): number | null {
  if (closes.length < 2) {
    return null;
  }
  const first = closes[0];
  const last = closes[closes.length - 1];
  if (first === 0) {
    return null;
  }
  return finiteOrNull(((last - first) / first) * 100);
}

/**
 * Day-over-day change in the latest close (absolute). `null` if there are fewer
 * than two closes.
 */
export function dailyChange(closes: number[]): number | null {
  if (closes.length < 2) {
    return null;
  }
  const current = closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  return finiteOrNull(current - previous);
}

/**
 * Day-over-day change in the latest close (percent). `null` if there are fewer
 * than two closes or the prior close is zero.
 */
export function dailyChangePercent(closes: number[]): number | null {
  if (closes.length < 2) {
    return null;
  }
  const current = closes[closes.length - 1];
  const previous = closes[closes.length - 2];
  if (previous === 0) {
    return null;
  }
  return finiteOrNull(((current - previous) / previous) * 100);
}

/**
 * Simple moving average of the most recent `period` closes. Returns `null`
 * until at least `period` points are available.
 */
export function sma(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period) {
    return null;
  }
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    sum += closes[i];
  }
  return finiteOrNull(sum / period);
}

/**
 * Rolling SMA aligned to `closes`: element `i` is the average of the window
 * ending at `i`, or `null` until the window is full. Used to draw moving-average
 * lines on the price chart.
 */
export function smaSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period <= 0) {
    return out;
  }
  let windowSum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    windowSum += closes[i];
    if (i >= period) {
      windowSum -= closes[i - period];
    }
    if (i >= period - 1) {
      out[i] = finiteOrNull(windowSum / period);
    }
  }
  return out;
}

/**
 * Relative Strength Index using Wilder's smoothing. Returns the latest value in
 * the range [0, 100], or `null` if there are fewer than `period + 1` closes.
 *
 * Conventions for degenerate windows: a window with no losses yields 100 (or 50
 * if it also has no gains, i.e. perfectly flat prices) instead of dividing by
 * zero.
 */
export function rsi(closes: number[], period: number = RSI_PERIOD): number | null {
  if (period <= 0 || closes.length < period + 1) {
    return null;
  }

  // Seed averages from the first `period` deltas.
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) {
      avgGain += delta;
    } else {
      avgLoss -= delta;
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing across the remaining deltas.
  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }
  const rs = avgGain / avgLoss;
  return finiteOrNull(100 - 100 / (1 + rs));
}

/**
 * Annualized volatility (percent), computed as the sample standard deviation of
 * daily log returns scaled by sqrt(trading days). Returns `null` if there are
 * fewer than two daily returns (i.e. fewer than three closes).
 */
export function annualizedVolatilityPct(
  closes: number[],
  tradingDays: number = TRADING_DAYS_PER_YEAR
): number | null {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    if (prev <= 0 || closes[i] <= 0) {
      continue;
    }
    returns.push(Math.log(closes[i] / prev));
  }
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((acc, r) => acc + r, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return finiteOrNull(Math.sqrt(variance) * Math.sqrt(tradingDays) * 100);
}

/**
 * Maximum drawdown (percent) over the window: the largest peak-to-trough decline
 * in closing price, returned as a non-positive number (e.g. -23.4 for a 23.4%
 * drop, 0 if prices never fell below a prior peak). Returns `null` for an empty
 * series.
 */
export function maxDrawdownPct(closes: number[]): number | null {
  if (closes.length === 0) {
    return null;
  }
  let peak = closes[0];
  let maxDrawdown = 0;
  for (const close of closes) {
    if (close > peak) {
      peak = close;
    }
    if (peak > 0) {
      const drawdown = (close - peak) / peak;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }
  return finiteOrNull(maxDrawdown * 100);
}
