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

// --- Phase 20: extended indicators ------------------------------------------

/** Default MACD periods (fast EMA, slow EMA, signal EMA). */
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;

/** Default Bollinger Band period and standard-deviation multiplier. */
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_MULTIPLIER = 2;

/**
 * Exponential moving average aligned to `values`: element `i` is the EMA of the
 * window ending at `i`, or `null` until `period` points exist. The series is
 * seeded with the simple average of the first `period` values (the standard
 * warm-up), then smoothed with the usual `k = 2 / (period + 1)` weight.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) {
    return out;
  }
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i += 1) {
    prev += values[i];
  }
  prev /= period;
  out[period - 1] = finiteOrNull(prev);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = finiteOrNull(prev);
  }
  return out;
}

/** Latest EMA of `values`, or `null` if there are fewer than `period` points. */
export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return finiteOrNull(series[series.length - 1]);
}

export interface MacdResult {
  /** MACD line: fast EMA − slow EMA. */
  macd: number | null;
  /** Signal line: EMA of the MACD line. */
  signal: number | null;
  /** Histogram: MACD − signal. */
  histogram: number | null;
}

/**
 * MACD (Moving Average Convergence/Divergence). Returns the LATEST values of the
 * MACD line, its signal line, and the histogram. Each is `null` until enough data
 * exists (the MACD line needs ~`slow` points; the signal needs ~`slow + signal`),
 * so a short window honestly reports the signal/histogram as unavailable rather
 * than guessing.
 */
export function macd(
  closes: number[],
  fast: number = MACD_FAST,
  slow: number = MACD_SLOW,
  signalPeriod: number = MACD_SIGNAL
): MacdResult {
  if (closes.length < slow) {
    return { macd: null, signal: null, histogram: null };
  }
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) {
      macdLine.push(f - s);
    }
  }
  const macdLatest = macdLine.length > 0 ? macdLine[macdLine.length - 1] : null;
  let signal: number | null = null;
  if (macdLine.length >= signalPeriod) {
    signal = ema(macdLine, signalPeriod);
  }
  const histogram =
    macdLatest !== null && signal !== null ? macdLatest - signal : null;
  return {
    macd: finiteOrNull(macdLatest),
    signal: finiteOrNull(signal),
    histogram: finiteOrNull(histogram),
  };
}

export interface BollingerBands {
  middle: number | null;
  upper: number | null;
  lower: number | null;
}

/**
 * Bollinger Bands over the most recent `period` closes: the middle band is the
 * SMA, the upper/lower bands are ±`multiplier` POPULATION standard deviations.
 * Returns all-null until `period` points are available.
 */
export function bollingerBands(
  closes: number[],
  period: number = BOLLINGER_PERIOD,
  multiplier: number = BOLLINGER_MULTIPLIER
): BollingerBands {
  if (period <= 0 || closes.length < period) {
    return { middle: null, upper: null, lower: null };
  }
  const window = closes.slice(closes.length - period);
  const mean = window.reduce((acc, v) => acc + v, 0) / period;
  const variance = window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    middle: finiteOrNull(mean),
    upper: finiteOrNull(mean + multiplier * sd),
    lower: finiteOrNull(mean - multiplier * sd),
  };
}

/**
 * Day-over-day change in trading volume (percent). `null` if there are fewer than
 * two bars or the prior volume is zero.
 */
export function volumeChangePct(volumes: number[]): number | null {
  if (volumes.length < 2) {
    return null;
  }
  const current = volumes[volumes.length - 1];
  const previous = volumes[volumes.length - 2];
  if (previous === 0) {
    return null;
  }
  return finiteOrNull(((current - previous) / previous) * 100);
}

/**
 * Deviation of the latest close from its `period`-day SMA, in percent
 * (positive = above the average). `null` until the SMA is computable or if the
 * SMA is zero.
 */
export function movingAverageDeviationPct(closes: number[], period: number): number | null {
  const avg = sma(closes, period);
  if (avg === null || avg === 0 || closes.length === 0) {
    return null;
  }
  const last = closes[closes.length - 1];
  return finiteOrNull(((last - avg) / avg) * 100);
}
