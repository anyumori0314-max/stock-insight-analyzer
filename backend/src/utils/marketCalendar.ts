/**
 * A SMALL, dependency-free US-equity trading-day calendar.
 *
 * It models weekends plus the major NYSE/Nasdaq FULL-day holidays — enough to
 * decide "what is the most recent COMPLETED trading day?" for the sync/freshness
 * logic and to keep the deterministic mock series off well-known closed days.
 *
 * It is deliberately NOT a complete exchange calendar: early closes and ad-hoc
 * closures are not modeled. The provider's own response date is always treated as
 * authoritative — this calendar only decides whether stored data is OLD ENOUGH to
 * be worth a (single) sync attempt, never what the "true" latest bar is.
 *
 * All reasoning is in UTC. The expected-latest helper is deliberately CONSERVATIVE
 * (a one-day margin), so we never expect a bar that may not be published yet
 * because of the close time or provider delivery delay.
 */

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
  const month = Math.floor((h + l - 7 * m + 114) / 31);
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
  const date = new Date(Date.UTC(year, month, day));
  const dow = date.getUTCDay();
  if (dow === 6) date.setUTCDate(day - 1);
  else if (dow === 0) date.setUTCDate(day + 1);
  return date;
}

const holidayCache = new Map<number, Set<string>>();

/** The major US equity-market full-day closures for a year (NYSE/Nasdaq). */
export function usMarketHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<string>([
    isoUtc(observedFixed(year, 0, 1)), // New Year's Day
    isoUtc(observedFixed(year, 5, 19)), // Juneteenth
    isoUtc(observedFixed(year, 6, 4)), // Independence Day
    isoUtc(observedFixed(year, 11, 25)), // Christmas
    isoUtc(nthWeekdayOfMonth(year, 0, 1, 3)), // MLK Day (3rd Mon Jan)
    isoUtc(nthWeekdayOfMonth(year, 1, 1, 3)), // Presidents' Day (3rd Mon Feb)
    isoUtc(lastWeekdayOfMonth(year, 4, 1)), // Memorial Day (last Mon May)
    isoUtc(nthWeekdayOfMonth(year, 8, 1, 1)), // Labor Day (1st Mon Sep)
    isoUtc(nthWeekdayOfMonth(year, 10, 4, 4)), // Thanksgiving (4th Thu Nov)
  ]);
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

/** True for Saturday / Sunday (UTC). */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** True when `date` (UTC) is a regular US trading day (not weekend / holiday). */
export function isTradingDay(date: Date): boolean {
  return !isWeekend(date) && !isUsMarketHoliday(date);
}

/**
 * Number of regular US trading days in the inclusive ISO date range
 * `[startIso, endIso]` (weekends and major holidays excluded). Returns 0 when the
 * range is empty/reversed or either bound is not a real calendar date. Bounded by
 * a hard cap on the number of days walked, so a pathological range can never spin.
 *
 * Used by the coverage service to estimate how many trading sessions SHOULD exist
 * between a ticker's earliest and latest stored bar, and thus how many are missing.
 */
export function countTradingDaysInclusive(startIso: string, endIso: string): number {
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  const endMs = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return 0;
  }
  // Guard against an absurd span (e.g. a corrupt date) walking forever: ~80 years.
  const MAX_DAYS = 366 * 80;
  let count = 0;
  const cursor = new Date(startMs);
  for (let i = 0; i <= MAX_DAYS; i += 1) {
    if (cursor.getTime() > endMs) {
      break;
    }
    if (isTradingDay(cursor)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** Parses a STRICT ISO `YYYY-MM-DD`, returning the UTC Date or null when the
 *  string is malformed or denotes an impossible day (e.g. `2026-02-30`, which a
 *  lenient parser would roll over). */
function parseIsoUtcStrict(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/**
 * THE single business-day judgment shared by coverage and the report shortfall
 * warning, so "how many trading days do we actually have?" is computed ONE way
 * everywhere (never as a raw row/bar count). Given a collection of ISO dates it
 * returns how many DISTINCT, real, non-future US trading days they cover:
 *  - duplicate date strings are counted once;
 *  - malformed / impossible dates (`2026-02-30`, `not-a-date`) are ignored;
 *  - dates after `now` (UTC) are ignored (a future bar is not "available" history);
 *  - weekends and major US market holidays do not count.
 *
 * This is why a 252-row CSV padded with weekends/holidays is NOT treated as a
 * full year: only the ~trading sessions inside it count toward 6m (~126) / 1y (~252).
 */
export function countTradingDays(
  dates: Iterable<string>,
  options: { now?: Date } = {}
): number {
  const now = options.now ?? new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const seen = new Set<string>();
  let count = 0;
  for (const iso of dates) {
    if (seen.has(iso)) continue; // de-duplicate by raw string
    seen.add(iso);
    const date = parseIsoUtcStrict(iso);
    if (!date) continue; // invalid / impossible date
    if (date.getTime() > todayMs) continue; // future date
    if (!isTradingDay(date)) continue; // weekend / holiday
    count += 1;
  }
  return count;
}

/**
 * The most recent COMPLETED US trading day as an ISO `YYYY-MM-DD`, computed
 * CONSERVATIVELY: it starts from YESTERDAY (UTC) and walks back to a trading day.
 * The one-day margin means we never expect today's bar before the session has
 * closed / been published. Stored data at or after this date is considered fresh;
 * the provider's actual response date remains authoritative for what is stored.
 */
export function expectedLatestCompletedTradingDay(now: Date): string {
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cursor.setUTCDate(cursor.getUTCDate() - 1); // start from yesterday (publish-delay margin)
  while (!isTradingDay(cursor)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return isoUtc(cursor);
}
