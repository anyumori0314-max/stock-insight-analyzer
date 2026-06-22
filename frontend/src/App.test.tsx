import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { jsonResponse, makeReport } from "./test/fixtures";

/** Pulls the ticker and `range` query out of a request URL. */
function parseUrl(url: string): { ticker: string; range: string } {
  const parsed = new URL(url, "http://localhost");
  const ticker = decodeURIComponent(parsed.pathname.split("/").pop() ?? "AAPL");
  const range = parsed.searchParams.get("range") ?? "3m";
  return { ticker, range };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Spies on fetch, returning a contract-valid report that echoes the requested
 * ticker AND range, so range-switch assertions reflect what the app asked for.
 */
function mockReportsFetch(overrides: Parameters<typeof makeReport>[0] = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const { ticker, range } = parseUrl(url);
    return jsonResponse(makeReport({ ticker, range: range as never, ...overrides }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App — startup makes no API calls", () => {
  it("renders the selection prompt and fetches nothing on mount", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<App />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("銘柄を選択すると株価データを取得します。")).toBeInTheDocument();
    // No tablist exists until a ticker is selected.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("App — window (range) selection", () => {
  it("defaults to the 3-month window and fetches it for the selected ticker", async () => {
    const fetchSpy = mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    await screen.findAllByText("104.00");

    // Exactly one fetch, defaulting to range=3m.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0] as string).toContain("range=3m");

    // The window control is an accessible group; the active window is pressed.
    expect(screen.getByRole("group", { name: "表示期間" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3か月", pressed: true })).toBeInTheDocument();
  });

  it("fetches another window on demand, then serves it from cache on return", async () => {
    const fetchSpy = mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    await screen.findAllByText("104.00");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Switch to the 1-month window: exactly one additional fetch, for range=1m.
    await user.click(screen.getByRole("button", { name: "1か月" }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(fetchSpy.mock.calls[1][0] as string).toContain("range=1m");
    expect(screen.getByRole("button", { name: "1か月", pressed: true })).toBeInTheDocument();

    // Back to the already-loaded 3-month window: NO new fetch.
    await user.click(screen.getByRole("button", { name: "3か月" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "3か月", pressed: true })).toBeInTheDocument();
  });
});

describe("App — selecting one ticker", () => {
  it("fetches only the selected ticker and renders the dashboard", async () => {
    const fetchSpy = mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));

    // Metrics appear once AAPL resolves.
    expect((await screen.findAllByText("104.00")).length).toBeGreaterThan(0);

    // Exactly one fetch, for AAPL only.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/api/stock/AAPL");

    // One tab for the single selected ticker.
    const tablist = screen.getByRole("tablist", { name: "表示銘柄" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1);

    // The disclaimer is always present.
    expect(screen.getByRole("contentinfo")).toHaveTextContent("投資助言");
  });
});

describe("App — error handling", () => {
  it("shows a single alert with a retry button on a 503", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ error: { code: "API_KEY_MISSING", message: "x" } }, { ok: false, status: 503 })
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));

    const panel = await screen.findByRole("tabpanel");
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent(/APIキー未設定/);
    expect(within(alert).getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("does not auto-retry after a rate-limit error; only explicit retry re-fetches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ error: { code: "PROVIDER_RATE_LIMITED", message: "x" } }, { ok: false, status: 429 })
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));

    const panel = await screen.findByRole("tabpanel");
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent(/利用上限/);

    // The full provider message appears ONCE (panel), not duplicated per row.
    expect(screen.getAllByText(/利用上限/)).toHaveLength(1);

    // No timers / effects re-fetch on their own: the count stays put over time.
    const callsAfterError = fetchSpy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterError);

    // Explicit retry triggers exactly one more fetch.
    await user.click(within(alert).getByRole("button", { name: "再試行" }));
    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBe(callsAfterError + 1));
  });
});

describe("App — mock data notice", () => {
  it("shows a notice when the report source is mock", async () => {
    mockReportsFetch({ source: "mock" });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    expect(await screen.findByText("開発用モックデータを表示しています。")).toBeInTheDocument();
  });
});

describe("App — React.StrictMode", () => {
  it("makes no API call on initial render under StrictMode", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("issues exactly one fetch per selection (no double-invoke duplicate)", async () => {
    const fetchSpy = mockReportsFetch();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    await screen.findAllByText("104.00");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0] as string).toContain("/api/stock/AAPL");
  });
});

describe("App — lazy-loaded chart (Phase 8 code-splitting)", () => {
  it("renders the empty prompt with no chart (Recharts not loaded yet)", () => {
    render(<App />);
    expect(screen.getByText("銘柄を選択すると株価データを取得します。")).toBeInTheDocument();
    expect(screen.queryByText(/価格チャート要約/)).not.toBeInTheDocument();
  });

  it("resolves the lazy chart after a ticker is selected", async () => {
    mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));

    // The lazily-imported PriceChart eventually renders its text summary.
    expect(await screen.findByText(/価格チャート要約/)).toBeInTheDocument();
  });
});

describe("App — range switch focus & aria-live (Phase 7 hardening)", () => {
  it("does NOT steal focus on a successful window switch (focus stays on the toggle)", async () => {
    const fetchSpy = mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    await screen.findAllByText("104.00");

    const oneMonth = screen.getByRole("button", { name: "1か月" });
    await user.click(oneMonth);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // Focus is not yanked to a generic heading — it remains on the pressed toggle.
    expect(oneMonth).toHaveFocus();
    expect(screen.getByRole("button", { name: "1か月", pressed: true })).toBeInTheDocument();
  });

  it("politely announces the active ticker AND window name on success", async () => {
    mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    await screen.findAllByText("104.00");

    // The visually-hidden polite live region names both ticker and window.
    expect(screen.getByText(/AAPL の 3か月 を表示しました/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1か月" }));
    expect(await screen.findByText(/AAPL の 1か月 を表示しました/)).toBeInTheDocument();
  });

  it("moves focus to the error region on an explicit error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ error: { code: "API_KEY_MISSING", message: "x" } }, { ok: false, status: 503 })
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));

    // The panel's error region (role="alert", focusable) receives focus.
    const panel = await screen.findByRole("tabpanel");
    const errorRegion = await within(panel).findByRole("alert");
    await vi.waitFor(() => expect(errorRegion).toHaveFocus());
    expect(errorRegion).toHaveClass("state--error");
  });

  it("keeps the window toggles keyboard-operable", async () => {
    const fetchSpy = mockReportsFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    await screen.findAllByText("104.00");

    const oneMonth = screen.getByRole("button", { name: "1か月" });
    oneMonth.focus();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "1か月", pressed: true })).toBeInTheDocument();
  });
});

describe("App — removing a ticker mid-request", () => {
  it("aborts the request and a late response does not revive the removed ticker", async () => {
    const gate = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gate.promise);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /AAPL/ }));
    // The comparison row offers a remove control while still loading.
    const removeButton = await screen.findByRole("button", { name: "AAPL を一覧から削除" });

    await user.click(removeButton);
    const signal = fetchSpy.mock.calls[0][1] as { signal: AbortSignal };
    expect(signal.signal.aborted).toBe(true);

    // Selection is now empty -> back to the prompt.
    expect(screen.getByText("銘柄を選択すると株価データを取得します。")).toBeInTheDocument();

    // The late response must not bring AAPL's data back.
    gate.resolve(jsonResponse(makeReport({ ticker: "AAPL" })));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText("104.00")).not.toBeInTheDocument();
    expect(screen.getByText("銘柄を選択すると株価データを取得します。")).toBeInTheDocument();
  });
});
