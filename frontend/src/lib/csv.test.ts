import { describe, expect, it } from "vitest";

import { escapeCsvField, neutralizeFormula, toCsv } from "./csv";

describe("neutralizeFormula", () => {
  it("prefixes a single quote for cells starting with a formula trigger", () => {
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(neutralizeFormula("+1+1")).toBe("'+1+1");
    expect(neutralizeFormula("@cmd")).toBe("'@cmd");
    expect(neutralizeFormula("-2+3+cmd")).toBe("'-2+3+cmd");
    expect(neutralizeFormula("\tTAB")).toBe("'\tTAB");
    expect(neutralizeFormula("\rCR")).toBe("'\rCR");
  });

  it("leaves plain numbers (incl. negatives) untouched", () => {
    expect(neutralizeFormula("-5.2")).toBe("-5.2");
    expect(neutralizeFormula("+10")).toBe("+10");
    expect(neutralizeFormula("104.00")).toBe("104.00");
    expect(neutralizeFormula("0")).toBe("0");
  });

  it("leaves ordinary text untouched", () => {
    expect(neutralizeFormula("AAPL")).toBe("AAPL");
    expect(neutralizeFormula("")).toBe("");
  });
});

describe("escapeCsvField", () => {
  it("RFC-4180 quotes fields with commas, quotes, or newlines", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes a formula AND quotes when it also contains a delimiter", () => {
    expect(escapeCsvField("=cmd,1")).toBe('"\'=cmd,1"');
  });

  it("renders null/undefined as an empty field", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("passes plain values and numbers through unquoted", () => {
    expect(escapeCsvField("AAPL")).toBe("AAPL");
    expect(escapeCsvField(-5.2)).toBe("-5.2");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and escapes every field", () => {
    const csv = toCsv([
      ["ticker", "note"],
      ["AAPL", "ok"],
      ["=EVIL", "a,b"],
    ]);
    expect(csv).toBe('ticker,note\r\nAAPL,ok\r\n\'=EVIL,"a,b"');
  });
});
