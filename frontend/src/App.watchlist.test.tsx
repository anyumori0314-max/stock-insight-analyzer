import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { jsonResponse, makeReport } from "./test/fixtures";
import { loadWatchlistState, saveWatchlistState } from "./lib/watchlistStorage";

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const parsed = new URL(url, "http://localhost");
    const ticker = decodeURIComponent(parsed.pathname.split("/").pop() ?? "AAPL");
    const range = parsed.searchParams.get("range") ?? "3m";
    return jsonResponse(makeReport({ ticker, range: range as never }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("App — watchlist persistence (Phase 17)", () => {
  it("restores the saved watchlist, selection and window on load and fetches the active ticker", async () => {
    saveWatchlistState({ watchlist: ["AAPL", "MSFT"], selectedTicker: "AAPL", selectedRange: "1m" });
    const fetchSpy = mockFetch();
    render(<App />);

    const list = screen.getByRole("list", { name: "保存された銘柄" });
    expect(within(list).getByText("AAPL")).toBeInTheDocument();
    expect(within(list).getByText("MSFT")).toBeInTheDocument();

    // The restored active ticker is fetched with the restored window.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/api/stock/AAPL");
    expect(url).toContain("range=1m");
  });

  it("persists a reorder so a reload reflects the new order", async () => {
    saveWatchlistState({ watchlist: ["AAPL", "MSFT"], selectedTicker: "AAPL", selectedRange: "3m" });
    mockFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "AAPL を下へ移動" }));
    await waitFor(() => expect(loadWatchlistState().watchlist).toEqual(["MSFT", "AAPL"]));

    // Simulate a reload: unmount and mount a fresh App.
    cleanup();
    render(<App />);
    const items = within(screen.getByRole("list", { name: "保存された銘柄" })).getAllByRole("listitem");
    expect(items[0].textContent).toContain("MSFT");
    expect(items[1].textContent).toContain("AAPL");
  });

  it("clears the watchlist on a confirmed reset and persists the empty state", async () => {
    saveWatchlistState({ watchlist: ["AAPL"], selectedTicker: "AAPL", selectedRange: "3m" });
    mockFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "すべて初期化" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(screen.getByText("銘柄を選択すると株価データを取得します。")).toBeInTheDocument();
    await waitFor(() => expect(loadWatchlistState().watchlist).toEqual([]));
  });

  it("refuses to add beyond the maximum and announces it", async () => {
    const many = Array.from({ length: 20 }, (_, i) => `T${i}`);
    saveWatchlistState({ watchlist: many, selectedTicker: many[0], selectedRange: "3m" });
    mockFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("ティッカーシンボル"), "NVDA");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByText(/最大20件/)).toBeInTheDocument();
    // NVDA was not added.
    expect(loadWatchlistState().watchlist).not.toContain("NVDA");
  });

  it("imports a watchlist from an uploaded JSON file", async () => {
    mockFetch();
    render(<App />);

    const payload = JSON.stringify({
      version: 1,
      watchlist: ["TSLA", "NFLX"],
      selectedTicker: "TSLA",
      selectedRange: "6m",
    });
    const file = new File([payload], "wl.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("ウォッチリストJSONをインポート"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "保存された銘柄" })).getByText("TSLA")).toBeInTheDocument()
    );
    expect(loadWatchlistState().watchlist).toEqual(["TSLA", "NFLX"]);
  });
});
