import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ComparisonTable } from "./ComparisonTable";
import type { ReportState } from "../hooks/useStockReports";
import { makeReport } from "../test/fixtures";

function renderTable(reports: Record<string, ReportState>, tickers: string[]) {
  render(
    <ComparisonTable
      tickers={tickers}
      reports={reports}
      activeTicker={tickers[0] ?? null}
      onSelect={vi.fn()}
      onRemove={vi.fn()}
    />
  );
}

describe("ComparisonTable — display only (never fetches)", () => {
  it("shows 未取得 for a ticker with no report yet", () => {
    renderTable({}, ["AAPL", "MSFT"]);
    expect(screen.getAllByText("未取得")).toHaveLength(2);
  });

  it("shows values only for fetched tickers and 未取得 for the rest", () => {
    renderTable(
      { AAPL: { status: "success", report: makeReport({ ticker: "AAPL" }) } },
      ["AAPL", "MSFT"]
    );

    // AAPL value present (plain number: fixture currency is null), MSFT untaken.
    // "104.00" can appear for both the price and the 100-based index column, so
    // assert presence (>=1) rather than uniqueness here.
    expect(screen.getAllByText("104.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("$104.00")).not.toBeInTheDocument();
    expect(screen.getByText("未取得")).toBeInTheDocument();
  });

  it("uses the row's currency for its price (no assumed $ when currency is null)", () => {
    renderTable(
      {
        AAPL: { status: "success", report: makeReport({ ticker: "AAPL", currency: null }) },
        MSFT: {
          status: "success",
          report: makeReport({ ticker: "MSFT", currency: "USD" }),
        },
      },
      ["AAPL", "MSFT"]
    );

    expect(screen.getAllByText("104.00").length).toBeGreaterThan(0); // null -> plain
    expect(screen.getByText("$104.00")).toBeInTheDocument(); // USD -> styled
  });

  it("renders the 100-based index column (期間開始を100とした相対指数)", () => {
    // periodReturnPercent +12 -> index 112.00; distinct from the price so the
    // index cell is unambiguous.
    const report = makeReport({ ticker: "AAPL" });
    renderTable(
      {
        AAPL: {
          status: "success",
          report: { ...report, metrics: { ...report.metrics, periodReturnPercent: 12 } },
        },
      },
      ["AAPL"]
    );
    expect(screen.getByText("指数(100基準)")).toBeInTheDocument();
    expect(screen.getByText("112.00")).toBeInTheDocument();
  });

  it("exposes the table as a keyboard-reachable, labelled scroll region", () => {
    renderTable(
      { AAPL: { status: "success", report: makeReport({ ticker: "AAPL" }) } },
      ["AAPL"]
    );
    const region = screen.getByRole("region", { name: /銘柄比較表（横スクロール可能）/ });
    expect(region).toHaveClass("table-wrap");
    expect(region).toHaveAttribute("tabindex", "0"); // scrollable area is focusable
  });

  it("shows a terse error per row, never the full provider message", () => {
    renderTable(
      {
        AAPL: {
          status: "error",
          message: "データ提供元の利用上限に達しました。しばらくしてから再度お試しください。",
          code: "PROVIDER_RATE_LIMITED",
        },
      },
      ["AAPL"]
    );

    expect(screen.getByText("取得できませんでした")).toBeInTheDocument();
    // The verbose rate-limit message must NOT be repeated in the table.
    expect(screen.queryByText(/利用上限/)).not.toBeInTheDocument();
  });
});
