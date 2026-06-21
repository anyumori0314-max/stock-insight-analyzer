import { describe, expect, it } from "vitest";

import { validateTicker } from "./tickers";

describe("validateTicker", () => {
  it("rejects empty / whitespace-only input", () => {
    expect(validateTicker("").ok).toBe(false);
    expect(validateTicker("   ").ok).toBe(false);
  });

  it("normalizes lowercase and surrounding whitespace", () => {
    expect(validateTicker("  aapl ")).toEqual({ ok: true, value: "AAPL" });
    expect(validateTicker("brk.b")).toEqual({ ok: true, value: "BRK.B" });
  });

  it("rejects invalid characters and over-long input", () => {
    expect(validateTicker("AA PL").ok).toBe(false);
    expect(validateTicker("AAPL!").ok).toBe(false);
    expect(validateTicker("RDS/A").ok).toBe(false);
    expect(validateTicker("ABCDEFGHIJK").ok).toBe(false); // 11 chars
  });

  it("accepts class-share style tickers", () => {
    expect(validateTicker("BF.A")).toEqual({ ok: true, value: "BF.A" });
    expect(validateTicker("BRK-B")).toEqual({ ok: true, value: "BRK-B" });
  });
});
