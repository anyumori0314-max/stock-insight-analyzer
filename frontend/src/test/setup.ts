import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// recharts' ResponsiveContainer measures its parent with ResizeObserver, which
// jsdom does not implement. Provide a no-op so chart components can render.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(() => {
  cleanup();
  // Watchlist persistence (Phase 17) writes to localStorage; clear it between
  // tests so a populated watchlist never leaks into a test that expects the
  // app to start empty.
  try {
    window.localStorage.clear();
  } catch {
    // Some tests stub localStorage to be unavailable; ignore.
  }
});
