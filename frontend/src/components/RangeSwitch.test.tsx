import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RangeSwitch } from "./RangeSwitch";
import { RANGE_OPTIONS } from "../lib/ranges";

describe("RangeSwitch — accessible window selector", () => {
  it("renders one toggle per supported window with display labels (not API values)", () => {
    render(<RangeSwitch value="3m" onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "表示期間" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(RANGE_OPTIONS.length);

    // Labels are the human-readable Japanese strings, never the raw "3m" codes.
    expect(within(group).getByRole("button", { name: "1か月" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "3か月" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "3m" })).not.toBeInTheDocument();
  });

  it("marks only the active window as pressed", () => {
    render(<RangeSwitch value="1m" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "1か月", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3か月", pressed: false })).toBeInTheDocument();
  });

  it("emits the API value (not the label) on selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RangeSwitch value="1m" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "3か月" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("3m");
  });

  it("offers the long 6か月 / 1年 windows (Phase 16)", () => {
    render(<RangeSwitch value="3m" onChange={vi.fn()} />);
    const group = screen.getByRole("group", { name: "表示期間" });
    expect(within(group).getByRole("button", { name: "6か月" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "1年" })).toBeInTheDocument();
  });

  it("emits the long-window API value on selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RangeSwitch value="3m" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "1年" }));
    expect(onChange).toHaveBeenCalledWith("1y");
  });

  it("is operable by keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RangeSwitch value="3m" onChange={onChange} />);

    await user.tab();
    // First focusable control is the first window toggle.
    expect(screen.getByRole("button", { name: "1か月" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("1m");
  });
});
