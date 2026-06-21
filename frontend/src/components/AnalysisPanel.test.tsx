import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AnalysisPanel } from "./AnalysisPanel";
import { makeReport } from "../test/fixtures";

const FORBIDDEN = [
  "買うべき",
  "売るべき",
  "買い時",
  "必ず上がる",
  "必ず下がる",
  "絶対",
  "強く推奨",
  "利益が見込める",
  "投資すべき",
];

describe("AnalysisPanel", () => {
  it("labels the score as a technical-state value and shows the misuse caveat", () => {
    render(<AnalysisPanel analysis={makeReport().analysis} />);
    expect(screen.getByText(/テクニカル状態スコア/)).toBeInTheDocument();
    expect(screen.getByText(/売買判断・将来リターン・推奨度を示すものではありません/)).toBeInTheDocument();
  });

  it("renders the verdict badges and comments", () => {
    render(<AnalysisPanel analysis={makeReport().analysis} />);
    expect(screen.getByText("上昇基調")).toBeInTheDocument();
    expect(screen.getByText("中立")).toBeInTheDocument();
  });

  it("contains no advisory / forbidden phrasing", () => {
    const { container } = render(<AnalysisPanel analysis={makeReport().analysis} />);
    const text = container.textContent ?? "";
    for (const phrase of FORBIDDEN) {
      expect(text).not.toContain(phrase);
    }
  });

  it("renders an em dash for a null score", () => {
    const analysis = { ...makeReport().analysis, score: null };
    render(<AnalysisPanel analysis={analysis} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
