import { describe, expect, it } from "vitest";

import {
  changeDirection,
  directionLabel,
  directionSymbol,
  formatPercent,
  formatPrice,
} from "./format";

describe("format helpers", () => {
  it("renders null/undefined/non-finite as an em dash", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("formats a price as a PLAIN number when the currency is unknown (no $/USD)", () => {
    expect(formatPrice(104)).toBe("104.00");
    expect(formatPrice(104, null)).toBe("104.00");
    expect(formatPercent(4)).toBe("+4.00%");
    expect(formatPercent(-3.5)).toBe("-3.50%");
  });

  it("uses the currency style only when a currency is known", () => {
    expect(formatPrice(104, "USD")).toBe("$104.00");

    const jpy = formatPrice(104, "JPY");
    expect(jpy).toContain("¥");
    expect(jpy).not.toContain("$");

    // An invalid/unsupported code never invents a symbol: number + raw code.
    expect(formatPrice(104, "US")).toBe("104.00 US");

    // Non-finite stays an em dash even with a currency.
    expect(formatPrice(null, "USD")).toBe("—");
  });

  it("derives direction and conveys it with symbol + text (not color alone)", () => {
    expect(changeDirection(4)).toBe("up");
    expect(changeDirection(-1)).toBe("down");
    expect(changeDirection(0)).toBe("flat");
    expect(directionSymbol("up")).toBe("▲");
    expect(directionSymbol("down")).toBe("▼");
    expect(directionLabel("up")).toBe("上昇");
    expect(directionLabel("down")).toBe("下落");
  });
});
