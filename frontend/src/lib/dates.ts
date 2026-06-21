/**
 * Real calendar date/time validation (UTC, timezone-independent).
 *
 * Mirrors `backend/src/utils/dates.ts` so the frontend rejects exactly the same
 * impossible values (e.g. `2026-02-30`, `2026-99-99T99:99:99Z`) the backend does.
 * Regex alone is insufficient — each value is round-tripped through `Date.UTC`.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const PROVIDER_DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** True only for a real `YYYY-MM-DD` calendar day. */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

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

/** True only for a real ISO 8601 UTC instant (e.g. `2026-06-19T00:05:00.000Z`). */
export function isRealIsoDateTimeUtc(value: string): boolean {
  const m = ISO_DATETIME_UTC.exec(value);
  if (!m) {
    return false;
  }
  const [, y, mo, d, h, mi, s, ms] = m;
  return isRealUtc(+y, +mo, +d, +h, +mi, +s, ms ? Number(ms.padEnd(3, "0")) : 0);
}

/** Accepts a real `YYYY-MM-DD` date or `YYYY-MM-DD HH:MM:SS` provider datetime. */
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
