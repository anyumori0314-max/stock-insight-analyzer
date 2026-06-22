import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TickerTabs } from "./TickerTabs";

const TICKERS = ["AAPL", "MSFT", "GOOGL"];

function renderTabs(active = "AAPL", onSelect = vi.fn()) {
  render(
    <TickerTabs tickers={TICKERS} activeTicker={active} onSelect={onSelect} panelId="panel-1" />
  );
  return onSelect;
}

describe("TickerTabs — WAI-ARIA tabs", () => {
  it("exposes a tablist of tabs with the correct ARIA wiring", () => {
    renderTabs();
    const tablist = screen.getByRole("tablist", { name: "表示銘柄" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);

    const active = screen.getByRole("tab", { name: "AAPL" });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("aria-controls", "panel-1");
    // Roving tabindex: only the active tab is in the tab order.
    expect(active).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "MSFT" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with Arrow / Home / End keys (selection follows focus)", async () => {
    const onSelect = renderTabs();
    const user = userEvent.setup();

    screen.getByRole("tab", { name: "AAPL" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith("MSFT");

    await user.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith("AAPL");

    await user.keyboard("{End}");
    expect(onSelect).toHaveBeenLastCalledWith("GOOGL");

    await user.keyboard("{Home}");
    expect(onSelect).toHaveBeenLastCalledWith("AAPL");
  });

  it("wraps around at the ends with the arrow keys", async () => {
    const onSelect = renderTabs();
    const user = userEvent.setup();

    screen.getByRole("tab", { name: "AAPL" }).focus();
    // Left from the first tab wraps to the last.
    await user.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith("GOOGL");
  });

  it("selects a tab on click", async () => {
    const onSelect = renderTabs();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "GOOGL" }));
    expect(onSelect).toHaveBeenLastCalledWith("GOOGL");
  });
});
