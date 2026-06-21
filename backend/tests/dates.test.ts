import { describe, expect, it } from "vitest";

import {
  isRealIsoDate,
  isRealIsoDateTimeUtc,
  isRealProviderTimestamp,
} from "../src/utils/dates";

describe("isRealIsoDate", () => {
  it("accepts real calendar dates (incl. a valid leap day)", () => {
    expect(isRealIsoDate("2026-06-17")).toBe(true);
    expect(isRealIsoDate("2024-02-29")).toBe(true); // 2024 is a leap year
  });

  it("rejects impossible or malformed dates", () => {
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2025-02-29")).toBe(false); // 2025 is not a leap year
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-00-10")).toBe(false);
    expect(isRealIsoDate("2026-06-31")).toBe(false);
    expect(isRealIsoDate("2026-6-7")).toBe(false); // not zero-padded
    expect(isRealIsoDate("not-a-date")).toBe(false);
  });
});

describe("isRealIsoDateTimeUtc", () => {
  it("accepts valid ISO 8601 UTC instants (with or without milliseconds)", () => {
    expect(isRealIsoDateTimeUtc("2026-06-19T00:05:00.000Z")).toBe(true);
    expect(isRealIsoDateTimeUtc("2026-06-19T00:05:00Z")).toBe(true);
  });

  it("rejects impossible / non-UTC / malformed datetimes", () => {
    expect(isRealIsoDateTimeUtc("2026-99-99T99:99:99Z")).toBe(false);
    expect(isRealIsoDateTimeUtc("2026-02-30T00:00:00Z")).toBe(false);
    expect(isRealIsoDateTimeUtc("2026-06-19T24:00:00Z")).toBe(false);
    expect(isRealIsoDateTimeUtc("2026-06-19T00:05:00")).toBe(false); // no Z
    expect(isRealIsoDateTimeUtc("2026-06-19 00:05:00Z")).toBe(false); // space, not T
    expect(isRealIsoDateTimeUtc("not-a-date")).toBe(false);
  });
});

describe("isRealProviderTimestamp", () => {
  it("accepts a plain date or a 'YYYY-MM-DD HH:MM:SS' datetime", () => {
    expect(isRealProviderTimestamp("2026-06-19")).toBe(true);
    expect(isRealProviderTimestamp("2026-06-19 16:00:00")).toBe(true);
  });

  it("rejects impossible values", () => {
    expect(isRealProviderTimestamp("2026-02-30")).toBe(false);
    expect(isRealProviderTimestamp("2026-06-19 25:00:00")).toBe(false);
    expect(isRealProviderTimestamp("2026-06-19T16:00:00Z")).toBe(false); // ISO 'T', not provider form
  });
});
