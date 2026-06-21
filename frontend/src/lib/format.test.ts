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

  it("formats prices and signed percentages", () => {
    expect(formatPrice(104)).toBe("$104.00");
    expect(formatPercent(4)).toBe("+4.00%");
    expect(formatPercent(-3.5)).toBe("-3.50%");
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
