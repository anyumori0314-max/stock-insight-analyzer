import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricsPanel } from "./MetricsPanel";
import { makeReport } from "../test/fixtures";

describe("MetricsPanel", () => {
  it("shows the current price and a signed daily change with symbol + text", () => {
    const { metrics } = makeReport();
    render(<MetricsPanel metrics={metrics} currency={null} />);

    // currency=null -> plain number, no assumed $, and a "通貨不明" note.
    expect(screen.getByText("104.00")).toBeInTheDocument();
    expect(screen.queryByText("$104.00")).not.toBeInTheDocument();
    expect(screen.getByText(/通貨不明/)).toBeInTheDocument();
    // Daily change conveys direction with an arrow glyph AND a text label.
    expect(screen.getByText(/▲/)).toBeInTheDocument();
    expect(screen.getAllByText("上昇").length).toBeGreaterThan(0);
  });

  it("uses the currency style and code label when a currency is known", () => {
    const { metrics } = makeReport();
    render(<MetricsPanel metrics={metrics} currency="USD" />);

    expect(screen.getByText("$104.00")).toBeInTheDocument();
    expect(screen.getByText(/（USD）/)).toBeInTheDocument();
    expect(screen.queryByText(/通貨不明/)).not.toBeInTheDocument();
  });

  it("renders a downward change with the down glyph and label", () => {
    const { metrics } = makeReport();
    render(
      <MetricsPanel
        metrics={{ ...metrics, dailyChange: -2, dailyChangePercent: -2 }}
        currency={null}
      />
    );
    expect(screen.getByText(/▼/)).toBeInTheDocument();
    expect(screen.getByText("下落")).toBeInTheDocument();
  });

  it("renders em dashes for null metrics", () => {
    const { metrics } = makeReport();
    render(
      <MetricsPanel
        metrics={{ ...metrics, sma20: null, sma50: null, rsi14: null, dailyChange: null, dailyChangePercent: null }}
        currency={null}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
