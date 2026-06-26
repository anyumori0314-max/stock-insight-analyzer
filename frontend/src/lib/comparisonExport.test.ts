import { describe, expect, it } from "vitest";

import { buildComparisonCsv, buildComparisonRows, COMPARISON_CSV_HEADERS } from "./comparisonExport";
import type { ReportState } from "../hooks/useStockReports";
import { makeReport } from "../test/fixtures";

function success(ticker: string, overrides = {}): ReportState {
  const base = makeReport({ ticker });
  return { status: "success", report: { ...base, metrics: { ...base.metrics, ...overrides } } };
}

describe("buildComparisonRows", () => {
  it("starts with the header row", () => {
    const rows = buildComparisonRows([], {}, "3m");
    expect(rows[0]).toEqual([...COMPARISON_CSV_HEADERS]);
  });

  it("emits status placeholders for non-success states", () => {
    const reports: Record<string, ReportState> = {
      L: { status: "loading" },
      E: { status: "error", message: "boom", code: "PROVIDER_UNAVAILABLE" },
    };
    const rows = buildComparisonRows(["L", "E", "N"], reports, "3m");
    expect(rows[1][2]).toBe("読み込み中");
    expect(rows[2][2]).toBe("取得失敗");
    expect(rows[3][2]).toBe("未取得"); // no entry
  });

  it("computes the 100-based index from the period return", () => {
    const rows = buildComparisonRows(["AAPL"], { AAPL: success("AAPL", { periodReturnPercent: 12 }) }, "3m");
    const indexCol = COMPARISON_CSV_HEADERS.indexOf("指数(100基準)");
    expect(rows[1][indexCol]).toBe(112);
  });

  it("blanks an unavailable numeric metric instead of writing null", () => {
    const rows = buildComparisonRows(["AAPL"], { AAPL: success("AAPL", { rsi14: null }) }, "3m");
    const rsiCol = COMPARISON_CSV_HEADERS.indexOf("RSI(14)");
    expect(rows[1][rsiCol]).toBe("");
  });
});

describe("buildComparisonCsv", () => {
  it("neutralizes a formula-injection attempt in a ticker symbol", () => {
    const csv = buildComparisonCsv(["=CMD"], { "=CMD": success("=CMD") }, "3m");
    expect(csv).toContain("'=CMD");
    expect(csv).not.toMatch(/(^|,)=CMD/);
  });

  it("produces a header line and one data line per ticker", () => {
    const csv = buildComparisonCsv(["AAPL", "MSFT"], { AAPL: success("AAPL") }, "1m");
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 tickers
    expect(lines[0]).toContain("銘柄");
  });
});
