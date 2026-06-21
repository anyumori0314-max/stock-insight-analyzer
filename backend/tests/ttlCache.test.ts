import { describe, expect, it } from "vitest";

import { createTtlCache } from "../src/services/ttlCache";

describe("createTtlCache — basic TTL", () => {
  it("stores and retrieves values before expiry (hit)", () => {
    let clock = 0;
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 10, now: () => clock });

    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(1);

    clock = 99; // still within ttl
    expect(cache.get("a")).toBe(1);
  });

  it("misses for unknown keys", () => {
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 10 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("treats the exact ttl boundary as expired (expiresAt <= now)", () => {
    let clock = 0;
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 10, now: () => clock });
    cache.set("a", 1);

    clock = 99;
    expect(cache.get("a")).toBe(1); // just inside
    clock = 100;
    expect(cache.get("a")).toBeUndefined(); // boundary -> expired
    expect(cache.size).toBe(0);
  });

  it("exposes expiry via getWithMeta", () => {
    let clock = 1_000;
    const cache = createTtlCache<string>({ ttlMs: 500, maxEntries: 10, now: () => clock });
    cache.set("a", "x");
    expect(cache.getWithMeta("a")).toEqual({ value: "x", expiresAt: 1_500 });
  });
});

describe("createTtlCache — max entries & eviction", () => {
  it("never exceeds maxEntries", () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 3 });
    for (let i = 0; i < 10; i += 1) {
      cache.set(`k${i}`, i);
    }
    expect(cache.size).toBe(3);
  });

  it("evicts the least-recently-used entry first (LRU order)", () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Touch "a" so "b" becomes the least-recently-used.
    expect(cache.get("a")).toBe(1);

    cache.set("d", 4); // capacity exceeded -> evict LRU ("b")
    expect(cache.has("b")).toBe(false);
    expect(cache.keys()).toEqual(["c", "a", "d"]); // oldest -> newest
  });

  it("prefers evicting an expired entry over a live LRU entry", () => {
    let clock = 0;
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 2, now: () => clock });

    cache.set("old", 1); // expiresAt = 100
    clock = 50;
    cache.set("fresh", 2); // expiresAt = 150

    clock = 120; // "old" is now expired, "fresh" still valid
    cache.set("new", 3); // must evict the expired "old", not the LRU live one

    expect(cache.has("old")).toBe(false);
    expect(cache.get("fresh")).toBe(2);
    expect(cache.get("new")).toBe(3);
  });

  it("supports delete and clear", () => {
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set("a", "x");
    cache.set("b", "y");

    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("does not share state between instances", () => {
    const a = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    const b = createTtlCache<number>({ ttlMs: 1000, maxEntries: 10 });
    a.set("k", 1);
    expect(b.get("k")).toBeUndefined();
  });
});
