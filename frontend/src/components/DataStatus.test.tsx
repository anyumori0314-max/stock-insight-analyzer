import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DataStatus } from "./DataStatus";
import { makeReport } from "../test/fixtures";

describe("DataStatus", () => {
  it("labels a fresh live report as ライブ / 新規取得", () => {
    render(
      <DataStatus
        report={makeReport({ source: "live", cache: { hit: false, expiresAt: "2026-06-19T00:05:00.000Z" } })}
      />
    );
    expect(screen.getByText("ライブ")).toBeInTheDocument();
    expect(screen.getByText("新規取得")).toBeInTheDocument();
  });

  it("labels a cached mock report as モックデータ / キャッシュ再利用", () => {
    render(
      <DataStatus
        report={makeReport({ source: "mock", cache: { hit: true, expiresAt: "2026-06-19T00:05:00.000Z" } })}
      />
    );
    expect(screen.getByText("モックデータ")).toBeInTheDocument();
    expect(screen.getByText("キャッシュ再利用")).toBeInTheDocument();
  });

  it("exposes the state as an accessible label (not color alone)", () => {
    render(
      <DataStatus
        report={makeReport({ source: "mock", cache: { hit: true, expiresAt: "2026-06-19T00:05:00.000Z" } })}
      />
    );
    // The whole line carries a text aria-label, so SR/color-blind users get it.
    expect(screen.getByLabelText(/データ状態：モックデータ、キャッシュ再利用/)).toBeInTheDocument();
  });
});
