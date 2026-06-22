import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom-detail");
}

describe("ErrorBoundary", () => {
  it("renders its children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>safe content</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("safe content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a safe fallback (role=alert) with a recovery button instead of crashing", () => {
    // React logs the caught error; silence it to keep the test output clean.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("表示中に問題が発生しました");
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("recovers and re-renders children when onReset clears the failing condition", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Maybe() {
      if (shouldThrow) {
        throw new Error("boom");
      }
      return <p>recovered content</p>;
    }

    render(
      <ErrorBoundary onReset={() => (shouldThrow = false)}>
        <Maybe />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByText("recovered content")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
