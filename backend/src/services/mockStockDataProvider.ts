import { type AlphaVantageClient } from "./alphaVantageClient";
import { DEFAULT_RANGE, type DailyBar, type StockRange, type StockTimeSeries } from "../types/stock";

/**
 * Deterministic, fully in-process stock data provider for local development.
 *
 * It implements the same {@link AlphaVantageClient} interface as the real
 * client, so the rest of the app (service, cache, in-flight dedup, report
 * builder, routes) is identical in `mock` and `live` modes — the ONLY thing that
 * changes is which provider the service is given. It NEVER performs any network
 * I/O and needs no API key, so developers can exercise the full UI (chart,
 * SMA20/50, RSI, analysis) without spending the provider's scarce free-tier quota.
 *
 * Determinism: the series for a ticker is generated from a seed derived purely
 * from the (normalized) ticker, so the same ticker always yields the same bars.
 * No `Date.now()` / `Math.random()` is used, making it a stable fixture.
 */

/** Number of trading days generated (within the requested 60–100 range). */
const MOCK_TRADING_DAYS = 80;

/**
 * Fixed anchor date the generated series ends on. Hard-coded so the mock output
 * is stable across runs and machines (no wall-clock dependency). It is a regular
 * US trading day — a weekday that is NOT a known market holiday. (The previous
 * anchor, 2026-06-19, was Juneteenth, a market closure.)
 *
 * This produces *deterministic development business-day data*, not a complete or
 * future-proof exchange trading calendar.
 */
export const MOCK_ANCHOR_DATE = "2026-06-17"; // Wednesday, a normal trading day

function isoUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Easter Sunday (Gregorian) via the anonymous Meeus/Jones/Butcher algorithm. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** The `n`-th `weekday` (0=Sun) of a month, e.g. 3rd Monday of January. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (7 + weekday - first.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

/** The last `weekday` (0=Sun) of a month, e.g. last Monday of May. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (7 + last.getUTCDay() - weekday) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
}

/** Observed date for a fixed-date holiday: Sat → preceding Fri, Sun → following Mon. */
function observedFixed(year: number, month: number, day: number): Date {
  const d = new Date(Date.UTC(year, month, day));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(day - 1);
  else if (dow === 0) d.setUTCDate(day + 1);
  return d;
}

const holidayCache = new Map<number, Set<string>>();

/**
 * The major US equity-market closures for a year (NYSE/Nasdaq full-day
 * holidays). Deliberately small and dependency-free — enough to keep the
 * deterministic development series off well-known closed days. It is NOT a
 * complete trading calendar: early closes and ad-hoc closures are not modeled.
 */
function usMarketHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<string>([
    // Fixed-date federal holidays (with weekend observance).
    isoUtc(observedFixed(year, 0, 1)), // New Year's Day
    isoUtc(observedFixed(year, 5, 19)), // Juneteenth
    isoUtc(observedFixed(year, 6, 4)), // Independence Day
    isoUtc(observedFixed(year, 11, 25)), // Christmas
    // Floating Monday/Thursday holidays.
    isoUtc(nthWeekdayOfMonth(year, 0, 1, 3)), // MLK Day (3rd Mon Jan)
    isoUtc(nthWeekdayOfMonth(year, 1, 1, 3)), // Presidents' Day (3rd Mon Feb)
    isoUtc(lastWeekdayOfMonth(year, 4, 1)), // Memorial Day (last Mon May)
    isoUtc(nthWeekdayOfMonth(year, 8, 1, 1)), // Labor Day (1st Mon Sep)
    isoUtc(nthWeekdayOfMonth(year, 10, 4, 4)), // Thanksgiving (4th Thu Nov)
  ]);
  // Good Friday: the Friday before Easter Sunday (a full market closure).
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  set.add(isoUtc(goodFriday));

  holidayCache.set(year, set);
  return set;
}

/** True when `date` (UTC) is a known major US equity-market holiday. */
export function isUsMarketHoliday(date: Date): boolean {
  return usMarketHolidays(date.getUTCFullYear()).has(isoUtc(date));
}

/** FNV-1a style string hash → unsigned 32-bit seed. */
function seedFromTicker(ticker: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < ticker.length; i += 1) {
    hash ^= ticker.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG: deterministic, seedable, returns a float in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The last `count` trading dates ending at `anchor`, ascending (oldest→newest).
 * Skips weekends and major US market holidays so the generated series looks like
 * real session data. Dates are unique and strictly increasing by construction.
 */
function tradingDatesEndingAt(anchor: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${anchor}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !isUsMarketHoliday(cursor)) {
      dates.push(isoUtc(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

/** Rounds to 2 decimals so generated prices look like real quotes. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Builds a deterministic, OHLC-consistent daily series for one ticker. The
 * random walk is gentle and mean-aware so the result exercises real indicator
 * behaviour (trend, SMA crossovers, RSI, drawdown) without going non-positive.
 */
export function generateMockSeries(
  ticker: string,
  range: StockRange = DEFAULT_RANGE
): StockTimeSeries {
  const normalized = ticker.toUpperCase();
  const rng = mulberry32(seedFromTicker(normalized));
  const dates = tradingDatesEndingAt(MOCK_ANCHOR_DATE, MOCK_TRADING_DAYS);

  // Seed-derived starting level (≈ $50–$450) and a small per-ticker drift.
  const basePrice = 50 + (seedFromTicker(normalized) % 400);
  const drift = (rng() - 0.45) * 0.0015; // slight, mostly-upward bias

  const bars: DailyBar[] = [];
  let prevClose = basePrice;

  for (const date of dates) {
    const shock = (rng() - 0.5) * 0.04; // ±2% daily noise
    const close = Math.max(1, prevClose * (1 + drift + shock));
    const open = Math.max(1, prevClose * (1 + (rng() - 0.5) * 0.01));
    const hi = Math.max(open, close) * (1 + rng() * 0.012);
    const lo = Math.min(open, close) * (1 - rng() * 0.012);
    const volume = Math.floor(1_000_000 + rng() * 8_000_000);

    bars.push({
      date,
      open: round2(open),
      high: round2(hi),
      low: round2(lo),
      close: round2(close),
      adjustedClose: null,
      volume,
    });
    prevClose = close;
  }

  return {
    ticker: normalized,
    range,
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: dates[dates.length - 1],
    priceBasis: "close",
    bars,
    warnings: ["開発用モックデータです（Alpha Vantage への通信は行っていません）。"],
  };
}

/**
 * Creates a mock provider that satisfies the {@link AlphaVantageClient} contract.
 * Async only to match the interface; it resolves immediately with the fixture.
 */
export function createMockStockDataProvider(): AlphaVantageClient {
  return {
    async fetchDailySeries(ticker: string, range: StockRange = DEFAULT_RANGE): Promise<StockTimeSeries> {
      return generateMockSeries(ticker, range);
    },
  };
}
