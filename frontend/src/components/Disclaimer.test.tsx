import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Disclaimer } from "./Disclaimer";

describe("Disclaimer", () => {
  it("states the required points", () => {
    render(<Disclaimer />);
    const text = screen.getByRole("contentinfo").textContent ?? "";

    expect(text).toContain("情報提供");
    expect(text).toContain("投資助言");
    expect(text).toContain("正確性");
    expect(text).toContain("将来の成果");
    expect(text).toContain("raw close");
    expect(text).toContain("利用者ご自身の責任");
    expect(text).toMatch(/遅延|停止|利用制限/);
  });
});
