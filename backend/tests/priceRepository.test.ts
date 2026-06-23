import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PriceBar } from "../src/domain/historical";
import { openTestStore, type TestStore } from "./historicalHelpers";

let store: TestStore;

beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

function bar(overrides: Partial<PriceBar> = {}): PriceBar {
  return {
    ticker: "AAPL",
    tradeDate: "2026-06-01",
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    adjustedClose: null,
    volume: 1000,
    currency: null,
    source: "csv",
    ...overrides,
  };
}

describe("PriceRepository", () => {
  it("classifies inserts, no-op re-inserts, and value changes", () => {
    const t = "2026-06-01T00:00:00.000Z";
    expect(store.prices.upsertBar(bar(), t, t)).toBe("inserted");
    // Same values again -> unchanged (idempotent).
    expect(store.prices.upsertBar(bar(), t, t)).toBe("unchanged");
    // A changed close -> updated.
    expect(store.prices.upsertBar(bar({ close: 11.5 }), t, t)).toBe("updated");
  });

  it("aggregates batch upsert counts", () => {
    const t = "2026-06-01T00:00:00.000Z";
    store.prices.upsertBar(bar({ tradeDate: "2026-06-01" }), t, t);
    const counts = store.prices.upsertBars(
      [
        bar({ tradeDate: "2026-06-01" }), // unchanged
        bar({ tradeDate: "2026-06-02" }), // inserted
        bar({ tradeDate: "2026-06-01", close: 99 }), // not reached as same date second time
      ],
      t,
      t
    );
    expect(counts.inserted).toBe(1);
    expect(counts.unchanged).toBe(1);
    // The third entry (same date, changed close) updates the row inserted above.
    expect(counts.updated).toBe(1);
  });

  it("reports the latest trade date and bar count", () => {
    const t = "2026-06-01T00:00:00.000Z";
    expect(store.prices.getLatestTradeDate("AAPL")).toBeNull();
    store.prices.upsertBars(
      [bar({ tradeDate: "2026-06-01" }), bar({ tradeDate: "2026-06-03" }), bar({ tradeDate: "2026-06-02" })],
      t,
      t
    );
    expect(store.prices.getLatestTradeDate("AAPL")).toBe("2026-06-03");
    expect(store.prices.countBars("AAPL")).toBe(3);
  });

  it("returns bars ascending, and the most-recent N (still ascending) with a limit", () => {
    const t = "2026-06-01T00:00:00.000Z";
    store.prices.upsertBars(
      ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"].map((d) => bar({ tradeDate: d })),
      t,
      t
    );
    const all = store.prices.getBars("AAPL");
    expect(all.map((b) => b.tradeDate)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]);

    const recent = store.prices.getBars("AAPL", 2);
    expect(recent.map((b) => b.tradeDate)).toEqual(["2026-06-03", "2026-06-04"]);
  });

  it("uses parameterized queries (a quote in the ticker cannot break SQL)", () => {
    const t = "2026-06-01T00:00:00.000Z";
    const weird = "A'B"; // not a valid ticker, but must be treated as data, never SQL
    expect(() => store.prices.upsertBar(bar({ ticker: weird }), t, t)).not.toThrow();
    expect(store.prices.getLatestTradeDate(weird)).toBe("2026-06-01");
  });

  it("preserves adjusted_close and currency round-trip", () => {
    const t = "2026-06-01T00:00:00.000Z";
    store.prices.upsertBar(bar({ adjustedClose: 10.25, currency: "USD" }), t, t);
    const [row] = store.prices.getBars("AAPL");
    expect(row.adjustedClose).toBe(10.25);
    expect(row.currency).toBe("USD");
  });
});
