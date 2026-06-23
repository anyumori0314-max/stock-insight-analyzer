import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTestStore, type TestStore } from "./historicalHelpers";

let store: TestStore;
beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

describe("ImportRunRepository", () => {
  it("opens a run as 'started' and closes it with counts and a safe summary", () => {
    const id = store.importRuns.start({
      sourceType: "csv",
      sourceName: "prices.csv",
      startedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(store.importRuns.get(id)?.status).toBe("started");

    store.importRuns.finish(id, {
      status: "completed",
      finishedAt: "2026-06-01T00:00:01.000Z",
      rowsRead: 10,
      rowsInserted: 7,
      rowsUpdated: 2,
      rowsUnchanged: 1,
    });
    const run = store.importRuns.get(id);
    expect(run).toMatchObject({
      status: "completed",
      sourceName: "prices.csv",
      rowsRead: 10,
      rowsInserted: 7,
      rowsUpdated: 2,
      rowsUnchanged: 1,
      rowsFailed: 0,
      safeErrorSummary: null,
    });
  });

  it("records a failed run with a safe error summary", () => {
    const id = store.importRuns.start({
      sourceType: "csv",
      sourceName: "bad.csv",
      startedAt: "2026-06-01T00:00:00.000Z",
    });
    store.importRuns.finish(id, {
      status: "failed",
      finishedAt: "2026-06-01T00:00:01.000Z",
      rowsRead: 3,
      rowsFailed: 3,
      safeErrorSummary: "2行目: 日付が不正です。",
    });
    expect(store.importRuns.get(id)?.status).toBe("failed");
    expect(store.importRuns.latest("csv")?.safeErrorSummary).toMatch(/日付/);
  });

  it("rejects an out-of-allow-list status via the CHECK constraint", () => {
    expect(() =>
      store.db
        .prepare("INSERT INTO import_runs (source_type, started_at, status) VALUES ('csv', 't', 'bogus')")
        .run()
    ).toThrow();
  });
});
