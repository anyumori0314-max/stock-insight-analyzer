import { describe, expect, it, vi } from "vitest";

import { createFallbackProvider, type FallbackHop } from "../src/providers/fallback";
import type { MarketDataProvider, ProviderCapabilities } from "../src/providers/types";
import { ApiError } from "../src/types/errors";
import type { StockRange, StockTimeSeries } from "../src/types/stock";

function caps(overrides: Partial<ProviderCapabilities> & { id: ProviderCapabilities["id"] }): ProviderCapabilities {
  return {
    label: overrides.id,
    requiresNetwork: false,
    requiresApiKey: false,
    isMock: false,
    supportedRanges: ["1m", "3m", "6m", "1y"] as StockRange[],
    maxLookbackTradingDays: 1000,
    ...overrides,
  };
}

function series(ticker: string, from: string): StockTimeSeries {
  return {
    ticker,
    range: "3m",
    currency: null,
    timezone: from,
    lastRefreshed: null,
    priceBasis: "close",
    bars: [{ date: "2025-01-02", open: 1, high: 1, low: 1, close: 1, adjustedClose: null, volume: 1 }],
    warnings: [from],
  };
}

function provider(
  c: ProviderCapabilities,
  impl: MarketDataProvider["fetchDailySeries"]
): MarketDataProvider {
  return { capabilities: c, fetchDailySeries: impl };
}

describe("createFallbackProvider", () => {
  it("returns the first provider's success without calling the rest", async () => {
    const second = vi.fn(async () => series("AAA", "second"));
    const fb = createFallbackProvider({
      providers: [
        provider(caps({ id: "alphaVantage" }), async () => series("AAA", "first")),
        provider(caps({ id: "sqlite" }), second),
      ],
    });
    const result = await fb.fetchDailySeries("AAA", "3m");
    expect(result.warnings).toContain("first");
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back to the next provider on error and reports the hop", async () => {
    const hops: FallbackHop[] = [];
    const fb = createFallbackProvider({
      onFallback: (h) => hops.push(h),
      providers: [
        provider(caps({ id: "alphaVantage" }), async () => {
          throw new ApiError(502, "PROVIDER_UNAVAILABLE", "down");
        }),
        provider(caps({ id: "sqlite" }), async () => series("AAA", "stored")),
      ],
    });
    const result = await fb.fetchDailySeries("AAA", "3m");
    expect(result.warnings).toContain("stored");
    expect(hops).toEqual([
      { fromId: "alphaVantage", toId: "sqlite", reason: "error", errorCode: "PROVIDER_UNAVAILABLE" },
    ]);
  });

  it("skips a provider that cannot back the requested range (capability-aware)", async () => {
    const av = vi.fn(async () => series("AAA", "live"));
    const hops: FallbackHop[] = [];
    const fb = createFallbackProvider({
      onFallback: (h) => hops.push(h),
      providers: [
        // AV cannot serve 1y (only 1m/3m).
        provider(caps({ id: "alphaVantage", supportedRanges: ["1m", "3m"] as StockRange[] }), av),
        provider(caps({ id: "sqlite" }), async () => series("AAA", "stored")),
      ],
    });
    const result = await fb.fetchDailySeries("AAA", "1y");
    expect(result.warnings).toContain("stored");
    expect(av).not.toHaveBeenCalled();
    expect(hops[0]).toMatchObject({ fromId: "alphaVantage", reason: "unsupported" });
  });

  it("re-throws the last real error when every provider fails", async () => {
    const fb = createFallbackProvider({
      providers: [
        provider(caps({ id: "alphaVantage" }), async () => {
          throw new ApiError(502, "PROVIDER_UNAVAILABLE", "a");
        }),
        provider(caps({ id: "sqlite" }), async () => {
          throw new ApiError(422, "INSUFFICIENT_DATA", "b");
        }),
      ],
    });
    await expect(fb.fetchDailySeries("AAA", "3m")).rejects.toMatchObject({
      code: "INSUFFICIENT_DATA",
    });
  });

  it("computes composite capabilities as the union of its members", () => {
    const fb = createFallbackProvider({
      providers: [
        provider(caps({ id: "alphaVantage", requiresNetwork: true, requiresApiKey: true, supportedRanges: ["1m", "3m"] as StockRange[] }), async () => series("AAA", "x")),
        provider(caps({ id: "sqlite", requiresNetwork: false, requiresApiKey: false }), async () => series("AAA", "y")),
      ],
    });
    expect(fb.capabilities.id).toBe("composite");
    expect(fb.capabilities.requiresNetwork).toBe(true); // some member needs it
    expect(fb.capabilities.requiresApiKey).toBe(false); // not EVERY member needs it
    expect(fb.capabilities.supportedRanges).toEqual(
      expect.arrayContaining(["1m", "3m", "6m", "1y"])
    );
  });

  it("throws when constructed with no providers", () => {
    expect(() => createFallbackProvider({ providers: [] })).toThrow();
  });
});
