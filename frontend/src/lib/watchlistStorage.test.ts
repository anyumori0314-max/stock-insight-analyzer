import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_WATCHLIST_TICKERS,
  WATCHLIST_SCHEMA_VERSION,
  WATCHLIST_STORAGE_KEY,
  defaultWatchlistState,
  isLocalStorageAvailable,
  loadWatchlistState,
  parseImportedWatchlist,
  sanitizeTickers,
  saveWatchlistState,
  serializeWatchlist,
  type WatchlistState,
} from "./watchlistStorage";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function writeRaw(value: unknown) {
  window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(value));
}

const sample: WatchlistState = {
  watchlist: ["AAPL", "MSFT", "NVDA"],
  selectedTicker: "MSFT",
  selectedRange: "6m",
};

describe("watchlistStorage — load/save round-trip", () => {
  it("returns the empty default when nothing is stored", () => {
    expect(loadWatchlistState()).toEqual(defaultWatchlistState());
  });

  it("restores the watchlist, order, selected ticker and range", () => {
    expect(saveWatchlistState(sample)).toEqual({ ok: true });
    const loaded = loadWatchlistState();
    expect(loaded.watchlist).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(loaded.selectedTicker).toBe("MSFT");
    expect(loaded.selectedRange).toBe("6m");
  });
});

describe("watchlistStorage — defensive parsing", () => {
  it("falls back to default on corrupt JSON", () => {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, "{not json");
    expect(loadWatchlistState()).toEqual(defaultWatchlistState());
  });

  it("resets on a mismatched schema version", () => {
    writeRaw({ version: 999, watchlist: ["AAPL"], selectedTicker: "AAPL", selectedRange: "3m" });
    expect(loadWatchlistState()).toEqual(defaultWatchlistState());
  });

  it("strips unknown fields and keeps only known state", () => {
    writeRaw({
      version: WATCHLIST_SCHEMA_VERSION,
      watchlist: ["AAPL"],
      selectedTicker: "AAPL",
      selectedRange: "1m",
      apiKey: "secret-should-be-ignored",
      __proto__hack: true,
    });
    const loaded = loadWatchlistState() as unknown as Record<string, unknown>;
    expect(loaded.watchlist).toEqual(["AAPL"]);
    expect(loaded).not.toHaveProperty("apiKey");
  });

  it("de-duplicates, trims and uppercases tickers", () => {
    writeRaw({
      version: WATCHLIST_SCHEMA_VERSION,
      watchlist: [" aapl ", "AAPL", "msft"],
      selectedTicker: null,
      selectedRange: "3m",
    });
    expect(loadWatchlistState().watchlist).toEqual(["AAPL", "MSFT"]);
  });

  it("drops entries that fail ticker validation", () => {
    writeRaw({
      version: WATCHLIST_SCHEMA_VERSION,
      watchlist: ["AAPL", "BAD TICKER", "X/Y", 42, null, "MSFT"],
      selectedTicker: null,
      selectedRange: "3m",
    });
    expect(loadWatchlistState().watchlist).toEqual(["AAPL", "MSFT"]);
  });

  it("caps the watchlist at the maximum size", () => {
    const many = Array.from({ length: MAX_WATCHLIST_TICKERS + 10 }, (_, i) => `T${i}`);
    writeRaw({ version: WATCHLIST_SCHEMA_VERSION, watchlist: many, selectedTicker: null, selectedRange: "3m" });
    expect(loadWatchlistState().watchlist).toHaveLength(MAX_WATCHLIST_TICKERS);
  });

  it("falls back to the first ticker when the selected one is absent", () => {
    writeRaw({
      version: WATCHLIST_SCHEMA_VERSION,
      watchlist: ["AAPL", "MSFT"],
      selectedTicker: "GONE",
      selectedRange: "3m",
    });
    expect(loadWatchlistState().selectedTicker).toBe("AAPL");
  });

  it("defaults an unsupported range to the standard window", () => {
    writeRaw({
      version: WATCHLIST_SCHEMA_VERSION,
      watchlist: ["AAPL"],
      selectedTicker: "AAPL",
      selectedRange: "10y",
    });
    expect(loadWatchlistState().selectedRange).toBe("3m");
  });
});

describe("watchlistStorage — sanitizeTickers", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeTickers("nope")).toEqual([]);
    expect(sanitizeTickers(undefined)).toEqual([]);
  });
});

describe("watchlistStorage — save failures", () => {
  it("reports a quota failure without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(saveWatchlistState(sample)).toEqual({ ok: false, reason: "quota" });
  });

  it("reports an unavailable store (SecurityError) without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(saveWatchlistState(sample)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("watchlistStorage — availability + read errors", () => {
  it("detects an unavailable localStorage and load returns the default", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(isLocalStorageAvailable()).toBe(true); // setItem still works in this stub
    // But a failing getItem must not crash load:
    expect(loadWatchlistState()).toEqual(defaultWatchlistState());
  });
});

describe("watchlistStorage — export/import", () => {
  it("serializes a versioned shape with no secret fields", () => {
    const json = serializeWatchlist(sample, () => new Date("2026-06-24T00:00:00Z"));
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(WATCHLIST_SCHEMA_VERSION);
    expect(parsed.watchlist).toEqual(sample.watchlist);
    expect(parsed.updatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(Object.keys(parsed).sort()).toEqual(
      ["selectedRange", "selectedTicker", "updatedAt", "version", "watchlist"].sort()
    );
  });

  it("imports a valid exported payload", () => {
    const json = serializeWatchlist(sample);
    const result = parseImportedWatchlist(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.watchlist).toEqual(sample.watchlist);
      expect(result.state.selectedRange).toBe("6m");
    }
  });

  it("rejects non-JSON import text", () => {
    const result = parseImportedWatchlist("definitely not json");
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects an import with the wrong shape", () => {
    const result = parseImportedWatchlist(JSON.stringify({ hello: "world" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects an import with an unsupported version", () => {
    const result = parseImportedWatchlist(
      JSON.stringify({ version: 99, watchlist: ["AAPL"], selectedTicker: "AAPL", selectedRange: "3m" })
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("sanitizes tickers on import (dedup + cap + validation)", () => {
    const result = parseImportedWatchlist(
      JSON.stringify({
        version: WATCHLIST_SCHEMA_VERSION,
        watchlist: [" aapl ", "AAPL", "bad ticker"],
        selectedTicker: null,
        selectedRange: "1y",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.watchlist).toEqual(["AAPL"]);
      expect(result.state.selectedRange).toBe("1y");
    }
  });
});
