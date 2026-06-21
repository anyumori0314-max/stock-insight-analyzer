import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import App from "./App";
import { jsonResponse, makeReport } from "./test/fixtures";

function tickerFromUrl(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? "AAPL");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App — integration", () => {
  it("loads reports and renders the dashboard with accessible tabs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(makeReport({ ticker: tickerFromUrl(url) }));
    });

    render(<App />);

    // Metrics appear once the active ticker resolves.
    expect((await screen.findAllByText("$104.00")).length).toBeGreaterThan(0);

    // Accessible tab pattern: a tablist with one tab per selected ticker.
    const tablist = screen.getByRole("tablist", { name: "表示銘柄" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(within(tablist).getByRole("tab", { name: "AAPL" })).toHaveAttribute("aria-selected", "true");

    // The panel the tabs control exists.
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();

    // The disclaimer is always present.
    expect(screen.getByRole("contentinfo")).toHaveTextContent("投資助言");
  });

  it("shows an alert when the API reports a missing key (503)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ error: { code: "API_KEY_MISSING", message: "x" } }, { ok: false, status: 503 })
    );

    render(<App />);

    // Scope to the data panel: the sidebar form also has a (normally empty)
    // live region with role="alert".
    const panel = await screen.findByRole("tabpanel");
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent(/APIキー未設定/);
    // A retry affordance is offered.
    expect(within(alert).getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
