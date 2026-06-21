import { describe, expect, it } from "vitest";

import { rawDailyBarSchema } from "../src/schemas/alphaVantage";

/** A valid raw bar; override a single field to probe its strict parsing. */
function rawBar(overrides: Record<string, unknown> = {}) {
  return {
    "1. open": "100",
    "2. high": "105",
    "3. low": "99",
    "4. close": "104",
    "5. volume": "1000",
    ...overrides,
  };
}

function accepts(overrides: Record<string, unknown>): boolean {
  return rawDailyBarSchema.safeParse(rawBar(overrides)).success;
}

describe("rawDailyBarSchema — volume (strict, non-negative safe integer)", () => {
  it("rejects empty / whitespace / non-string-or-number values", () => {
    expect(accepts({ "5. volume": "" })).toBe(false);
    expect(accepts({ "5. volume": "   " })).toBe(false);
    expect(accepts({ "5. volume": null })).toBe(false);
    expect(accepts({ "5. volume": undefined })).toBe(false);
    expect(accepts({ "5. volume": false })).toBe(false);
    expect(accepts({ "5. volume": [] })).toBe(false);
    expect(accepts({ "5. volume": {} })).toBe(false);
  });

  it("rejects partial-numeric, fractional, negative and unsafe-integer values", () => {
    expect(accepts({ "5. volume": "123abc" })).toBe(false);
    expect(accepts({ "5. volume": "1.5" })).toBe(false);
    expect(accepts({ "5. volume": "-1" })).toBe(false);
    expect(accepts({ "5. volume": String(Number.MAX_SAFE_INTEGER + 1) })).toBe(false);
    expect(accepts({ "5. volume": "1e309" })).toBe(false); // -> Infinity
  });

  it("accepts a plain non-negative integer string (and 0)", () => {
    expect(accepts({ "5. volume": "100" })).toBe(true);
    expect(accepts({ "5. volume": "0" })).toBe(true);
  });

  it("accepts surrounding whitespace around an otherwise valid integer (documented policy)", () => {
    const parsed = rawDailyBarSchema.safeParse(rawBar({ "5. volume": " 100 " }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data["5. volume"]).toBe(100);
    }
  });
});

describe("rawDailyBarSchema — price (strict, positive finite)", () => {
  it("rejects empty / null / undefined / non-finite / partial-numeric / non-positive", () => {
    expect(accepts({ "1. open": "" })).toBe(false);
    expect(accepts({ "1. open": "   " })).toBe(false);
    expect(accepts({ "1. open": null })).toBe(false);
    expect(accepts({ "1. open": undefined })).toBe(false);
    expect(accepts({ "1. open": "1e309" })).toBe(false); // Infinity
    expect(accepts({ "1. open": "NaN" })).toBe(false);
    expect(accepts({ "1. open": "123abc" })).toBe(false);
    expect(accepts({ "1. open": "0" })).toBe(false); // not > 0
    expect(accepts({ "1. open": "-1" })).toBe(false);
  });

  it("accepts a positive numeric string (incl. decimals)", () => {
    expect(accepts({ "1. open": "100" })).toBe(true);
    expect(accepts({ "1. open": "100.25" })).toBe(true);
  });
});
