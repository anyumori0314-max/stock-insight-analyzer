import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { DataStatus } from "./DataStatus";
import { makeDataStatus, makeReport } from "../test/fixtures";

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

  it("renders the rich data-status detail for a historical report", () => {
    render(
      <DataStatus
        report={makeReport({
          source: "historical",
          dataStatus: makeDataStatus({ dataSource: "sqlite", latestTradeDate: "2026-06-17", recordCount: 63 }),
        })}
      />
    );
    expect(screen.getByText("ローカル履歴データ", { selector: ".tag" })).toBeInTheDocument();
    expect(screen.getByText("最新取引日")).toBeInTheDocument();
    expect(screen.getByText("2026-06-17")).toBeInTheDocument();
    expect(screen.getByText("63件")).toBeInTheDocument();
  });

  it("announces a stale state via a polite status region", () => {
    render(
      <DataStatus report={makeReport({ source: "historical", dataStatus: makeDataStatus({ stale: true }) })} />
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/時間が経過/);
  });

  it("announces a provider-failure fallback via an assertive alert (saved data still shown)", () => {
    render(
      <DataStatus
        report={makeReport({
          source: "hybrid",
          dataStatus: makeDataStatus({ dataMode: "hybrid", dataSource: "sqlite", fallbackUsed: true, stale: true }),
        })}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/保存済みデータを表示/);
    // When falling back we show the alert, not a duplicate stale note.
    expect(screen.queryByRole("status")).toBeNull();
    // The data itself is still rendered (not a full-screen error).
    expect(screen.getByText("最新取引日")).toBeInTheDocument();
  });

  it("shows the CSV import and API sync timestamps when present", () => {
    render(
      <DataStatus
        report={makeReport({
          source: "hybrid",
          dataStatus: makeDataStatus({
            dataMode: "hybrid",
            dataSource: "api",
            csvImportedAt: "2026-06-23T01:00:00.000Z",
            apiSyncedAt: "2026-06-23T02:30:00.000Z",
          }),
        })}
      />
    );
    expect(screen.getByText("CSV取込")).toBeInTheDocument();
    expect(screen.getByText("2026-06-23 01:00 UTC")).toBeInTheDocument();
    expect(screen.getByText("API同期")).toBeInTheDocument();
    expect(screen.getByText("2026-06-23 02:30 UTC")).toBeInTheDocument();
  });
});
