import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Sidebar } from "./Sidebar";

function setup(selected: string[] = []) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(<Sidebar selected={selected} onAdd={onAdd} onRemove={onRemove} />);
  return { onAdd, onRemove, user: userEvent.setup() };
}

describe("Sidebar — ticker form", () => {
  it("shows an error and does not submit an empty ticker", async () => {
    const { onAdd, user } = setup();
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("ティッカーを入力してください");
  });

  it("normalizes a lowercase ticker on submit", async () => {
    const { onAdd, user } = setup();
    await user.type(screen.getByLabelText("ティッカーシンボル"), "aapl");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(onAdd).toHaveBeenCalledWith("AAPL");
  });

  it("submits on Enter", async () => {
    const { onAdd, user } = setup();
    await user.type(screen.getByLabelText("ティッカーシンボル"), "msft{Enter}");
    expect(onAdd).toHaveBeenCalledWith("MSFT");
  });

  it("rejects invalid characters without calling onAdd", async () => {
    const { onAdd, user } = setup();
    await user.type(screen.getByLabelText("ティッカーシンボル"), "AA PL");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("使用できない文字");
  });

  it("warns when the ticker is already selected", async () => {
    const { onAdd, user } = setup(["AAPL"]);
    await user.type(screen.getByLabelText("ティッカーシンボル"), "aapl");
    await user.click(screen.getByRole("button", { name: "追加" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("すでに追加");
  });
});

describe("Sidebar — ticker input form quality", () => {
  it("gives the input a stable id + name and a matching associated label", () => {
    setup();
    const input = screen.getByLabelText("ティッカーシンボル");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("id", "ticker-input");
    expect(input).toHaveAttribute("name", "ticker");
    expect(input).toHaveAttribute("autocomplete", "off");

    const label = screen.getByText("ティッカーシンボル");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "ticker-input");
  });

  it("renders the submit button with the .btn class and stays operable", async () => {
    const { onAdd, user } = setup();
    const submit = screen.getByRole("button", { name: "追加" });
    expect(submit).toHaveClass("btn");

    await user.type(screen.getByLabelText("ティッカーシンボル"), "nvda");
    await user.click(submit);
    expect(onAdd).toHaveBeenCalledWith("NVDA");
  });
});

describe("Sidebar — FANG+ presets", () => {
  it("notes that the preset is not the official index", () => {
    setup();
    expect(screen.getByText(/公式指数（NYSE FANG\+）の最新構成を保証するものではありません/)).toBeInTheDocument();
  });

  it("toggles a preset: adds when unselected, removes when selected", async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = render(<Sidebar selected={[]} onAdd={onAdd} onRemove={onRemove} />);
    const user = userEvent.setup();

    const apple = screen.getByRole("button", { name: /AAPL/ });
    expect(apple).toHaveAttribute("aria-pressed", "false");
    await user.click(apple);
    expect(onAdd).toHaveBeenCalledWith("AAPL");

    rerender(<Sidebar selected={["AAPL"]} onAdd={onAdd} onRemove={onRemove} />);
    const appleSelected = screen.getByRole("button", { name: /AAPL/ });
    expect(appleSelected).toHaveAttribute("aria-pressed", "true");
    await user.click(appleSelected);
    expect(onRemove).toHaveBeenCalledWith("AAPL");
  });
});
