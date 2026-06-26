import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WatchlistPanel } from "./WatchlistPanel";

function setup(overrides: Partial<Parameters<typeof WatchlistPanel>[0]> = {}) {
  const props = {
    watchlist: ["AAPL", "MSFT", "ZZZZ"],
    presets: new Set(["AAPL", "MSFT"]),
    activeTicker: "MSFT",
    statusMessage: "",
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onReset: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };
  render(<WatchlistPanel {...props} />);
  return { props, user: userEvent.setup() };
}

describe("WatchlistPanel", () => {
  it("renders each item and labels preset vs user-added origin", () => {
    setup();
    const list = screen.getByRole("list", { name: "保存された銘柄" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    // ZZZZ is not a preset => labelled as 個別追加.
    const custom = within(list).getByText("ZZZZ").closest("li")!;
    expect(within(custom).getByText("個別追加")).toBeInTheDocument();
  });

  it("shows an empty hint when there is nothing stored", () => {
    setup({ watchlist: [], activeTicker: null });
    expect(screen.getByText(/プリセットを選ぶか/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "保存された銘柄" })).not.toBeInTheDocument();
  });

  it("disables move-up on the first row and move-down on the last", () => {
    setup();
    expect(screen.getByRole("button", { name: "AAPL を上へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ZZZZ を下へ移動" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "MSFT を上へ移動" })).toBeEnabled();
  });

  it("reorders by keyboard via the move buttons", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "MSFT を上へ移動" }));
    expect(props.onMove).toHaveBeenCalledWith("MSFT", "up");
  });

  it("removes an item", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "AAPL をウォッチリストから削除" }));
    expect(props.onRemove).toHaveBeenCalledWith("AAPL");
  });

  it("requires a two-step confirm before resetting everything", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "すべて初期化" }));
    expect(props.onReset).not.toHaveBeenCalled();
    // Confirm appears; cancel backs out without resetting.
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(props.onReset).not.toHaveBeenCalled();
    // Re-open and confirm.
    await user.click(screen.getByRole("button", { name: "すべて初期化" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it("triggers export", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "エクスポート" }));
    expect(props.onExport).toHaveBeenCalledTimes(1);
  });

  it("reads an uploaded file and forwards its text to onImport", async () => {
    const { props } = setup();
    const file = new File(['{"version":1}'], "watchlist.json", { type: "application/json" });
    const input = screen.getByLabelText("ウォッチリストJSONをインポート") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(props.onImport).toHaveBeenCalledWith('{"version":1}'));
  });

  it("exposes a polite live region carrying the status message", () => {
    setup({ statusMessage: "ウォッチリストをインポートしました（2件）。" });
    const region = screen.getByText("ウォッチリストをインポートしました（2件）。");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
