import { describe, expect, it } from "vitest";

import { createDataFreshnessService } from "../src/services/dataFreshnessService";

// Fixed "now": Tue 2026-06-23. The most recent completed trading day is Mon 06-22.
const NOW = () => new Date("2026-06-23T12:00:00.000Z");

describe("DataFreshnessService", () => {
  it("reports empty data as not-stale with null age", () => {
    const fresh = createDataFreshnessService({ now: NOW }).compute(null, 0);
    expect(fresh).toEqual({ latestTradeDate: null, recordCount: 0, stale: false, ageHours: null });
  });

  it("treats data at the latest completed trading day as fresh", () => {
    const result = createDataFreshnessService({ now: NOW }).compute("2026-06-22", 60);
    expect(result.stale).toBe(false);
    expect(result.latestTradeDate).toBe("2026-06-22");
    expect(result.recordCount).toBe(60);
  });

  it("flags data behind the latest completed trading day as stale", () => {
    const result = createDataFreshnessService({ now: NOW }).compute("2026-06-17", 60);
    expect(result.stale).toBe(true);
    expect(result.ageHours).toBeGreaterThan(24);
  });
});
