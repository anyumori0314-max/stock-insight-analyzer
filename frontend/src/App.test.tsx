import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { jsonResponse, makeReport } from "./test/fixtures";

function tickerFromUrl(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? "AAPL");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Spies on fetch, returning a contract-valid report for the requested ticker. */
function mockReportsFetch(overrides: Parameters<typeof makeReport>[0] = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    return jsonResponse(makeReport({ ticker: tickerFromUrl(url), ...overrides }));
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
