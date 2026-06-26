import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PriceChart } from "./PriceChart";
import { makeReport } from "../test/fixtures";

describe("PriceChart", () => {
  it("shows a fallback message when there is no data", () => {
    render(
      <PriceChart bars={[]} priceBasis="close" currency={null} range="3m" trend="unknown" />
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
    expect(summary.textContent).toContain("3m");
    expect(summary.textContent).toContain("終値（調整前）");
    expect(summary.textContent).toContain("104.00");
    expect(summary.textContent).toContain("上昇基調");
  });

  it("hides the chart visual from assistive tech with no focusable element inside it", () => {
    const report = makeReport();
    const { container } = render(
      <PriceChart
        bars={report.series}
        priceBasis={report.priceBasis}
        currency={report.currency}
        range={report.range}
        trend={report.analysis.trend}
      />
    );

    // The accessible representation is the figure's caption, not the SVG.
    const figure = container.querySelector("figure.chart-figure");
    expect(figure).toBeInTheDocument();
    expect(figure?.querySelector("figcaption.chart-summary")?.textContent).toMatch(
      /価格チャート要約/
    );

    // The visual chart subtree (the SVG canvas) is hidden from assistive tech ...
    const hidden = container.querySelector(".chart-canvas");
    expect(hidden).toBeInTheDocument();
    expect(hidden).toHaveAttribute("aria-hidden", "true");

    // ... and must NOT contain a keyboard focus stop (no tabindex=0), so a
    // keyboard user is never stranded on an element screen readers can't see.
    expect(hidden?.querySelector('[tabindex="0"]')).toBeNull();

    // The accessible legend lives OUTSIDE the hidden subtree so it is announced.
    const legend = container.querySelector(".chart-legend");
    expect(legend).toBeInTheDocument();
    expect(legend?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("renders a single data point without throwing", () => {
    const report = makeReport({ series: makeReport().series.slice(0, 1) });
    render(
      <PriceChart
        bars={report.series}
        priceBasis="close"
        currency={null}
        range="3m"
        trend="unknown"
      />
    );
    expect(screen.getByText(/価格チャート要約/)).toBeInTheDocument();
  });
});
