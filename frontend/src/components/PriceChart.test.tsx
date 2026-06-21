import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PriceChart } from "./PriceChart";
import { makeReport } from "../test/fixtures";

describe("PriceChart", () => {
  it("shows a fallback message when there is no data", () => {
    render(
      <PriceChart bars={[]} priceBasis="close" currency={null} range="100d" trend="unknown" />
    );
    expect(screen.getByText(/表示できる価格データがありません/)).toBeInTheDocument();
  });

  it("renders a text summary (priceBasis, range, latest value, trend) for assistive tech", () => {
    const report = makeReport();
    render(
      <PriceChart
        bars={report.series}
        priceBasis={report.priceBasis}
        currency={report.currency}
        range={report.range}
        trend={report.analysis.trend}
      />
    );
    const summary = screen.getByText(/価格チャート要約/);
    expect(summary.textContent).toContain("100d");
    expect(summary.textContent).toContain("終値（調整前）");
    expect(summary.textContent).toContain("$104.00");
    expect(summary.textContent).toContain("上昇基調");
  });

  it("renders a single data point without throwing", () => {
    const report = makeReport({ series: makeReport().series.slice(0, 1) });
    render(
      <PriceChart
        bars={report.series}
        priceBasis="close"
        currency={null}
        range="100d"
        trend="unknown"
      />
    );
    expect(screen.getByText(/価格チャート要約/)).toBeInTheDocument();
  });
});
