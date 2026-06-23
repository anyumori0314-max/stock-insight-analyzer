import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTestStore, type TestStore } from "./historicalHelpers";

let store: TestStore;
beforeEach(() => {
  store = openTestStore();
});
afterEach(() => {
  store.close();
});

describe("SyncStateRepository", () => {
  it("returns null for an unknown ticker", () => {
    expect(store.syncState.get("AAPL")).toBeNull();
  });

  it("upserts an attempt and preserves the last success on a later failure", () => {
    store.syncState.recordAttempt({
      ticker: "AAPL",
      attemptAt: "2026-06-01T00:00:00.000Z",
      result: "success",
      latestTradeDate: "2026-05-29",
      successAt: "2026-06-01T00:00:00.000Z",
    });
    let state = store.syncState.get("AAPL");
    expect(state).toMatchObject({
      lastResult: "success",
      latestTradeDate: "2026-05-29",
      lastSuccessAt: "2026-06-01T00:00:00.000Z",
    });

    // A later FAILED attempt keeps the previous success timestamp + latest date.
    store.syncState.recordAttempt({
      ticker: "AAPL",
      attemptAt: "2026-06-02T00:00:00.000Z",
      result: "failed",
      errorCode: "PROVIDER_TIMEOUT",
      safeErrorMessage: "プロバイダ応答タイムアウト",
    });
    state = store.syncState.get("AAPL");
    expect(state).toMatchObject({
      lastResult: "failed",
      lastErrorCode: "PROVIDER_TIMEOUT",
      lastSuccessAt: "2026-06-01T00:00:00.000Z",
      latestTradeDate: "2026-05-29",
      lastAttemptAt: "2026-06-02T00:00:00.000Z",
    });
  });
});
