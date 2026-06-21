import { describe, expect, it } from "vitest";

import { isRealIsoDate, isRealIsoDateTimeUtc, isRealProviderTimestamp } from "./dates";

// Mirrors backend/tests/dates.test.ts so frontend and backend judge identically.

describe("isRealIsoDate", () => {
  it("accepts real dates (incl. a valid leap day)", () => {
    expect(isRealIsoDate("2026-06-17")).toBe(true);
    expect(isRealIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects impossible / malformed dates", () => {
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2025-02-29")).toBe(false);
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-00-10")).toBe(false);
    expect(isRealIsoDate("not-a-date")).toBe(false);
  });
});

describe("isRealIsoDateTimeUtc", () => {
  it("accepts valid ISO 8601 UTC instants", () => {
    expect(isRealIsoDateTimeUtc("2026-06-19T00:05:00.000Z")).toBe(true);
    expect(isRealIsoDateTimeUtc("2026-06-19T00:05:00Z")).toBe(true);
  });

  it("rejects impossible / non-UTC datetimes", () => {
    expect(isRealIsoDateTimeUtc("2026-99-99T99:99:99Z")).toBe(false);
    expect(isRealIsoDateTimeUtc("2026-06-19T24:00:00Z")).toBe(false);
    expect(isRealIsoDateTimeUtc("2026-06-19T00:05:00")).toBe(false);
    expect(isRealIsoDateTimeUtc("not-a-date")).toBe(false);
  });
});

describe("isRealProviderTimestamp", () => {
  it("accepts a date or a 'YYYY-MM-DD HH:MM:SS' datetime", () => {
    expect(isRealProviderTimestamp("2026-06-19")).toBe(true);
    expect(isRealProviderTimestamp("2026-06-19 16:00:00")).toBe(true);
  });

  it("rejects impossible values", () => {
    expect(isRealProviderTimestamp("2026-02-30")).toBe(false);
    expect(isRealProviderTimestamp("2026-06-19 25:00:00")).toBe(false);
  });
});
