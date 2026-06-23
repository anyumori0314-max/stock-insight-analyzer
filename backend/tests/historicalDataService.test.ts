import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PriceBar } from "../src/domain/historical";
import { createHistoricalDataService } from "../src/services/historicalDataService";
import { openTestStore, type TestStore } from "./historicalHelpers";

let store: TestStore;
beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

function seed(bars: Array<Partial<PriceBar> & { tradeDate: string }>) {
  const t = "2026-06-01T00:00:00.000Z";
  store.prices.upsertBars(
    bars.map((b) => ({
      ticker: "AAPL",
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      adjustedClose: null,
      volume: 1000,
      currency: null,
      source: "csv" as const,
      ...b,
    })),
    t,
    t
  );
}

describe("HistoricalDataService", () => {
  it("returns null when the store has no bars for the ticker", () => {
    const service = createHistoricalDataService({ priceRepository: store.prices });
    expect(service.getTimeSeries("AAPL", "3m")).toBeNull();
  });

  it("builds an ascending series with lastRefreshed = newest stored date", () => {
    seed([{ tradeDate: "2026-06-01" }, { tradeDate: "2026-06-03" }, { tradeDate: "2026-06-02" }]);
    const service = createHistoricalDataService({ priceRepository: store.prices });
    const series = service.getTimeSeries("AAPL", "3m");
    expect(series).not.toBeNull();
    expect(series!.bars.map((b) => b.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(series!.lastRefreshed).toBe("2026-06-03");
    expect(series!.priceBasis).toBe("close");
  });

  it("uses the most recent non-null currency", () => {
    seed([
      { tradeDate: "2026-06-01", currency: "USD" },
      { tradeDate: "2026-06-02", currency: null },
    ]);
    const service = createHistoricalDataService({ priceRepository: store.prices });
    expect(service.getTimeSeries("AAPL", "3m")!.currency).toBe("USD");
  });

  it("bounds the read with fetchLimit (most recent N)", () => {
    seed(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"].map((d) => ({ tradeDate: d })));
    const service = createHistoricalDataService({ priceRepository: store.prices, fetchLimit: 2 });
    expect(service.getTimeSeries("AAPL", "3m")!.bars.map((b) => b.date)).toEqual([
      "2026-06-03",
      "2026-06-04",
    ]);
  });
});
