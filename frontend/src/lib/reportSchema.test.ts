import { describe, expect, it } from "vitest";

import { dataStatusSchema, stockReportSchema } from "./reportSchema";
import { makeDataStatus, makeReport } from "../test/fixtures";

/**
 * Guards the frontend ⇄ backend contract for Phase 15. These mirror
 * `backend/src/schemas/report.ts`; if the two drift, one side's tests break.
 */
describe("stockReportSchema — Phase 15 dataStatus + source modes", () => {
  it("accepts a report WITHOUT dataStatus (Phase 2–11 back-compat)", () => {
    const report = makeReport();
    delete (report as { dataStatus?: unknown }).dataStatus;
    expect(stockReportSchema.safeParse(report).success).toBe(true);
  });

  it("accepts the four data-serving modes for source", () => {
    for (const source of ["live", "mock", "historical", "hybrid"] as const) {
      expect(stockReportSchema.safeParse(makeReport({ source })).success).toBe(true);
    }
  });

  it("rejects an unknown source", () => {
    expect(stockReportSchema.safeParse({ ...makeReport(), source: "fake" }).success).toBe(false);
  });

  it("validates a well-formed dataStatus block", () => {
    const report = makeReport({ source: "historical", dataStatus: makeDataStatus() });
    expect(stockReportSchema.safeParse(report).success).toBe(true);
  });

  it("rejects an unknown field inside dataStatus (strict)", () => {
    const bad = { ...makeDataStatus(), sneaky: "leak" };
    expect(dataStatusSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an impossible latestTradeDate", () => {
    const bad = makeDataStatus({ latestTradeDate: "2026-02-30" });
    expect(dataStatusSchema.safeParse(bad).success).toBe(false);
  });

  it("requires recordCount to be a non-negative integer", () => {
    expect(dataStatusSchema.safeParse(makeDataStatus({ recordCount: -1 })).success).toBe(false);
    expect(dataStatusSchema.safeParse(makeDataStatus({ recordCount: 1.5 })).success).toBe(false);
  });
});
