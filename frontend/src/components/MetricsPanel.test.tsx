import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricsPanel } from "./MetricsPanel";
import { makeReport } from "../test/fixtures";

describe("MetricsPanel", () => {
  it("shows the current price and a signed daily change with symbol + text", () => {
    const { metrics } = makeReport();
    render(<MetricsPanel metrics={metrics} currency={null} />);

    expect(screen.getByText("$104.00")).toBeInTheDocument();
    // Daily change conveys direction with an arrow glyph AND a text label.
    expect(screen.getByText(/▲/)).toBeInTheDocument();
    expect(screen.getAllByText("上昇").length).toBeGreaterThan(0);
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
