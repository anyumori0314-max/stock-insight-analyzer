/**
 * Real calendar date/time validation (UTC, timezone-independent).
 *
 * Regex alone accepts impossible values like `2026-02-30` or `2026-99-99`. These
 * helpers additionally round-trip the parsed components through `Date.UTC` so
 * only dates/times that actually exist are accepted, with no dependence on the
 * host's local timezone.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
// Alpha Vantage "Last Refreshed" can be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS".
const PROVIDER_DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** True only for an ISO `YYYY-MM-DD` string that denotes a real calendar day. */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Validates Y/M/D/H/M/S components by round-tripping through `Date.UTC`. */
function isRealUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, ms = 0): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

/**
 * True only for a valid ISO 8601 UTC instant as produced by `Date#toISOString()`
 * (e.g. `2026-06-19T00:05:00.000Z`). Rejects impossible values such as
 * `2026-99-99T99:99:99Z`.
 */
export function isRealIsoDateTimeUtc(value: string): boolean {
  const m = ISO_DATETIME_UTC.exec(value);
  if (!m) {
    return false;
  }
  const [, y, mo, d, h, mi, s, ms] = m;
  return isRealUtc(+y, +mo, +d, +h, +mi, +s, ms ? Number(ms.padEnd(3, "0")) : 0);
}

/**
 * Accepts the timestamp formats Alpha Vantage actually returns for
 * `3. Last Refreshed`: a real `YYYY-MM-DD` date, or a real
 * `YYYY-MM-DD HH:MM:SS` datetime. Both are validated for real-calendar existence.
 */
export function isRealProviderTimestamp(value: string): boolean {
  if (isRealIsoDate(value)) {
    return true;
  }
  const m = PROVIDER_DATETIME.exec(value);
  if (!m) {
    return false;
  }
  const [, y, mo, d, h, mi, s] = m;
  return isRealUtc(+y, +mo, +d, +h, +mi, +s);
}
