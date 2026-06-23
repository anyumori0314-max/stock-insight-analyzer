import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createJobLock } from "../src/services/jobLock";
import { openTestStore, type TestStore } from "./historicalHelpers";

let store: TestStore;
let clock: { value: number };
const now = () => new Date(clock.value);

beforeEach(() => {
  store = openTestStore();
  clock = { value: Date.parse("2026-06-23T00:00:00.000Z") };
});
afterEach(() => {
  store.close();
});

describe("JobLock", () => {
  it("grants the lock once and records owner / run id / start time", () => {
    const lock = createJobLock(store.db, { now });
    const handle = lock.acquire("daily", { ttlSeconds: 60, owner: "pid:123" });
    expect(handle).not.toBeNull();
    expect(handle!.owner).toBe("pid:123");
    expect(lock.inspect("daily")).toMatchObject({ owner: "pid:123", runId: handle!.runId });
  });

  it("rejects a second acquire while a valid lock is held", () => {
    const lock = createJobLock(store.db, { now });
    expect(lock.acquire("daily", { ttlSeconds: 60 })).not.toBeNull();
    expect(lock.acquire("daily", { ttlSeconds: 60 })).toBeNull();
  });

  it("reclaims an EXPIRED lock (no permanent lock after a crash)", () => {
    const lock = createJobLock(store.db, { now });
    const first = lock.acquire("daily", { ttlSeconds: 60 });
    expect(first).not.toBeNull();
    // Advance past the TTL: the stale lock is reclaimable.
    clock.value += 61_000;
    const second = lock.acquire("daily", { ttlSeconds: 60 });
    expect(second).not.toBeNull();
    expect(second!.runId).not.toBe(first!.runId);
  });

  it("releases only with the matching run id, freeing the lock", () => {
    const lock = createJobLock(store.db, { now });
    const handle = lock.acquire("daily", { ttlSeconds: 60 })!;
    // A different run id cannot release someone else's lock.
    lock.release({ ...handle, runId: "someone-else" });
    expect(lock.inspect("daily")).not.toBeNull();
    // The true owner releases it.
    lock.release(handle);
    expect(lock.inspect("daily")).toBeNull();
  });
});
