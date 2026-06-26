import { describe, expect, it } from "vitest";

import {
  countTradingDays,
  countTradingDaysInclusive,
  expectedLatestCompletedTradingDay,
  isTradingDay,
} from "../src/utils/marketCalendar";

describe("countTradingDaysInclusive", () => {
  it("counts a full Mon–Fri week as 5 trading days", () => {
    // 2026-06-22 is a Monday (a regular trading day); 06-26 is the Friday.
    expect(countTradingDaysInclusive("2026-06-22", "2026-06-26")).toBe(5);
  });

  it("excludes weekends inside the span", () => {
    // Mon 06-22 .. Sun 06-28 still has only the 5 weekday sessions.
    expect(countTradingDaysInclusive("2026-06-22", "2026-06-28")).toBe(5);
  });

  it("excludes a market holiday inside the span", () => {
    // 2026-07-04 (Independence Day) falls on a Saturday, observed Fri 07-03.
    // Mon 06-29 .. Fri 07-03 => Mon,Tue,Wed,Thu trade; Fri is the holiday => 4.
    expect(countTradingDaysInclusive("2026-06-29", "2026-07-03")).toBe(4);
  });

  it("returns 1 for a single trading day and 0 for a single weekend day", () => {
    expect(countTradingDaysInclusive("2026-06-22", "2026-06-22")).toBe(1);
    expect(countTradingDaysInclusive("2026-06-27", "2026-06-27")).toBe(0); // Saturday
  });

  it("returns 0 for a reversed or invalid range", () => {
    expect(countTradingDaysInclusive("2026-06-26", "2026-06-22")).toBe(0);
    expect(countTradingDaysInclusive("not-a-date", "2026-06-22")).toBe(0);
    expect(countTradingDaysInclusive("2026-06-22", "2026-13-99")).toBe(0);
  });

  it("agrees with isTradingDay / expectedLatestCompletedTradingDay anchors", () => {
    expect(isTradingDay(new Date("2026-06-22T00:00:00Z"))).toBe(true);
    expect(isTradingDay(new Date("2026-06-27T00:00:00Z"))).toBe(false);
    expect(expectedLatestCompletedTradingDay(new Date("2026-06-23T12:00:00Z"))).toBe("2026-06-22");
  });
});

describe("countTradingDays", () => {
  const NOW = { now: new Date("2026-07-15T00:00:00Z") };

  it("counts only the trading days, excluding weekends", () => {
    // Mon 06-22 .. Sun 06-28: 5 weekday sessions, Sat/Sun excluded.
    const dates = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26", "2026-06-27", "2026-06-28"];
    expect(countTradingDays(dates, NOW)).toBe(5);
  });

  it("excludes a market holiday", () => {
    // 2026-07-03 is the observed Independence Day holiday.
    expect(countTradingDays(["2026-07-02", "2026-07-03"], NOW)).toBe(1);
  });

  it("counts a duplicate date only once", () => {
    expect(countTradingDays(["2026-06-22", "2026-06-22", "2026-06-23"], NOW)).toBe(2);
  });

  it("ignores impossible / malformed dates", () => {
    expect(countTradingDays(["2026-02-30", "not-a-date", "2026-13-01", "2026-06-22"], NOW)).toBe(1);
  });

  it("ignores future-dated entries relative to now", () => {
    // With now = 2026-06-24, the later weekday sessions are still in the future.
    const dates = ["2026-06-22", "2026-06-23", "2026-06-25", "2026-06-26"];
    expect(countTradingDays(dates, { now: new Date("2026-06-24T00:00:00Z") })).toBe(2);
  });

  it("returns 0 for an empty collection", () => {
    expect(countTradingDays([], NOW)).toBe(0);
  });
});
