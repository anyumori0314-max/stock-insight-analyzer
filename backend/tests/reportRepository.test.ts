import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STOCK_REPORT_CACHE_SCHEMA_VERSION,
  createFileReportRepository,
} from "../src/services/reportRepository";
import type { StockReport } from "../src/types/report";
import type { StockDataMode, StockRange } from "../src/types/stock";

function makeReport(
  ticker = "AAPL",
  range: StockRange = "3m",
  source: StockDataMode = "live"
): StockReport {
  return {
    ticker,
    source,
    range,
    currency: null,
    timezone: "US/Eastern",
    lastRefreshed: "2026-06-19",
    priceBasis: "close",
    series: [
      { date: "2026-06-19", open: 100, high: 105, low: 99, close: 104, adjustedClose: null, volume: 1000, sma20: null, sma50: null },
    ],
    metrics: {
      currentPrice: 104,
      dailyChange: null,
      dailyChangePercent: null,
      periodReturnPercent: null,
      sma20: null,
      sma50: null,
      rsi14: null,
      annualizedVolatilityPercent: null,
      maxDrawdownPercent: null,
    },
    analysis: { trend: "unknown", momentum: "unknown", risk: "unknown", score: null, comments: [] },
    warnings: [],
    cache: { hit: false, expiresAt: "2026-06-19T00:05:00.000Z" },
    disclaimer: "参考情報です。",
  };
}

const jsonFiles = async (dir: string) => (await readdir(dir)).filter((f) => f.endsWith(".json"));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "sia-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("file report repository — persistence", () => {
  it("round-trips a report through disk", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport(), Date.now() + 60_000);

    const got = await repo.get("AAPL", "3m", "live");
    expect(got?.report.ticker).toBe("AAPL");
    expect(got?.report.range).toBe("3m");
  });

  it("returns null for a missing entry", async () => {
    const repo = createFileReportRepository({ dir });
    expect(await repo.get("MSFT", "1m", "live")).toBeNull();
  });

  it("keys entries by ticker:range", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "1m", "live", makeReport("AAPL", "1m"), Date.now() + 60_000);
    await repo.set("AAPL", "3m", "live", makeReport("AAPL", "3m"), Date.now() + 60_000);

    expect((await repo.get("AAPL", "1m", "live"))?.report.range).toBe("1m");
    expect((await repo.get("AAPL", "3m", "live"))?.report.range).toBe("3m");
  });

  it("treats an expired entry as a miss and removes it", async () => {
    let clock = 1_000;
    const repo = createFileReportRepository({ dir, now: () => clock });
    await repo.set("AAPL", "3m", "live", makeReport(), 1_100);

    clock = 5_000; // past expiry
    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
    expect(await jsonFiles(dir)).toHaveLength(0);
  });

  it("delete() removes the entry for the (key, mode)", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport(), Date.now() + 60_000);
    await repo.delete("AAPL", "3m", "live");
    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
    expect(await jsonFiles(dir)).toHaveLength(0);
  });
});

describe("file report repository — data-mode separation", () => {
  it("does NOT serve a mock-saved entry when reading in live mode", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "mock", makeReport("AAPL", "3m", "mock"), Date.now() + 60_000);

    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
    // The mock entry itself is still readable in mock mode.
    expect((await repo.get("AAPL", "3m", "mock"))?.report.source).toBe("mock");
  });

  it("does NOT serve a live-saved entry when reading in mock mode", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport("AAPL", "3m", "live"), Date.now() + 60_000);

    expect(await repo.get("AAPL", "3m", "mock")).toBeNull();
  });

  it("keeps live and mock entries on separate files (no collision)", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport("AAPL", "3m", "live"), Date.now() + 60_000);
    await repo.set("AAPL", "3m", "mock", makeReport("AAPL", "3m", "mock"), Date.now() + 60_000);

    expect(await jsonFiles(dir)).toHaveLength(2);
    expect((await repo.get("AAPL", "3m", "live"))?.report.source).toBe("live");
    expect((await repo.get("AAPL", "3m", "mock"))?.report.source).toBe("mock");
  });

  it("deletes an entry whose stored source contradicts its dataMode (poisoned)", async () => {
    const repo = createFileReportRepository({ dir });
    // Hand-write a live-mode file whose payload claims source:"mock".
    await writeFile(
      path.join(dir, "AAPL__3m__live.json"),
      JSON.stringify({
        schemaVersion: STOCK_REPORT_CACHE_SCHEMA_VERSION,
        key: "AAPL:3m",
        dataMode: "live",
        expiresAtMs: Date.now() + 60_000,
        lastAccessMs: Date.now(),
        report: makeReport("AAPL", "3m", "mock"),
      }),
      "utf8"
    );

    expect(await repo.get("AAPL", "3m", "live")).toBeNull(); // contradiction -> drop
    expect(await jsonFiles(dir)).toHaveLength(0);
  });

  it("a mock entry is never returned with source:'live'", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "mock", makeReport("AAPL", "3m", "mock"), Date.now() + 60_000);
    const live = await repo.get("AAPL", "3m", "live");
    expect(live).toBeNull(); // not re-published as live
  });
});

describe("file report repository — corruption & schema safety", () => {
  it("recovers from a corrupt file (drops it, returns null)", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport(), Date.now() + 60_000);
    const [file] = await jsonFiles(dir);
    await writeFile(path.join(dir, file), "{ not valid json", "utf8");

    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
  });

  it("discards an entry written under a different schema version (e.g. legacy v1)", async () => {
    const repo = createFileReportRepository({ dir });
    await writeFile(
      path.join(dir, "AAPL__3m__live.json"),
      JSON.stringify({
        schemaVersion: STOCK_REPORT_CACHE_SCHEMA_VERSION - 1, // an old/legacy version
        key: "AAPL:3m",
        dataMode: "live",
        expiresAtMs: Date.now() + 60_000,
        report: makeReport(),
      }),
      "utf8"
    );
    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
    expect(await jsonFiles(dir)).toHaveLength(0);
  });

  it("discards an entry whose payload key does not match the file", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport("MSFT", "3m"), Date.now() + 60_000);
    // The stored report's ticker (MSFT) disagrees with the requested key (AAPL).
    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
  });

  it("never writes the API key or raw provider data — only the public report", async () => {
    const repo = createFileReportRepository({ dir });
    await repo.set("AAPL", "3m", "live", makeReport(), Date.now() + 60_000);
    const [file] = await jsonFiles(dir);
    const content = await readFile(path.join(dir, file), "utf8");

    expect(content).not.toMatch(/api[_-]?key|authorization|bearer/i);
  });

  it("degrades silently (no throw) when the directory cannot be created", async () => {
    // Put a FILE where a parent directory would need to be, so mkdir fails.
    await writeFile(path.join(dir, "blocker"), "x", "utf8");
    const repo = createFileReportRepository({ dir: path.join(dir, "blocker", "sub") });

    await expect(
      repo.set("AAPL", "3m", "live", makeReport(), Date.now() + 60_000)
    ).resolves.toBeUndefined();
    expect(await repo.get("AAPL", "3m", "live")).toBeNull();
  });
});

describe("file report repository — LRU by last access", () => {
  it("never keeps more than maxEntries files", async () => {
    const repo = createFileReportRepository({ dir, maxEntries: 2 });
    await repo.set("AAA", "1m", "live", makeReport("AAA", "1m"), Date.now() + 60_000);
    await repo.set("BBB", "1m", "live", makeReport("BBB", "1m"), Date.now() + 60_000);
    await repo.set("CCC", "1m", "live", makeReport("CCC", "1m"), Date.now() + 60_000);

    expect((await jsonFiles(dir)).length).toBeLessThanOrEqual(2);
  });

  it("evicts the least-recently-USED entry, not the oldest written (a read keeps it alive)", async () => {
    let clock = 1_000;
    const repo = createFileReportRepository({ dir, maxEntries: 2, now: () => clock });

    clock = 1_000;
    await repo.set("AAA", "1m", "live", makeReport("AAA", "1m"), 10_000_000);
    clock = 2_000;
    await repo.set("BBB", "1m", "live", makeReport("BBB", "1m"), 10_000_000);

    // Read AAA (the oldest WRITTEN) so it becomes the most-recently USED.
    clock = 3_000;
    expect(await repo.get("AAA", "1m", "live")).not.toBeNull();

    // Writing CCC exceeds the cap: BBB (least-recently used) must be evicted, not AAA.
    clock = 4_000;
    await repo.set("CCC", "1m", "live", makeReport("CCC", "1m"), 10_000_000);

    expect(await repo.get("BBB", "1m", "live")).toBeNull(); // evicted
    expect(await repo.get("AAA", "1m", "live")).not.toBeNull(); // survived (recently read)
    expect(await repo.get("CCC", "1m", "live")).not.toBeNull();
  });

  it("evicts expired entries first, before any fresh least-recently-used one", async () => {
    let clock = 1_000;
    const repo = createFileReportRepository({ dir, maxEntries: 2, now: () => clock });

    // AAA expires soon; BBB is long-lived but written first/least-recently-used.
    clock = 1_000;
    await repo.set("AAA", "1m", "live", makeReport("AAA", "1m"), 2_000); // expires at 2000
    clock = 1_500;
    await repo.set("BBB", "1m", "live", makeReport("BBB", "1m"), 10_000_000);

    // Past AAA's expiry; adding CCC triggers eviction — the EXPIRED AAA goes first.
    clock = 3_000;
    await repo.set("CCC", "1m", "live", makeReport("CCC", "1m"), 10_000_000);

    expect(await repo.get("AAA", "1m", "live")).toBeNull(); // expired -> evicted first
    expect(await repo.get("BBB", "1m", "live")).not.toBeNull();
    expect(await repo.get("CCC", "1m", "live")).not.toBeNull();
  });
});
