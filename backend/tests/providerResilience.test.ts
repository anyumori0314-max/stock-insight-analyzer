import { describe, expect, it, vi } from "vitest";

import {
  createCircuitBreaker,
  createRateLimiter,
  withCircuitBreaker,
  withInflightDedup,
  withRateLimit,
  withTimeout,
} from "../src/providers/resilience";
import type { MarketDataProvider } from "../src/providers/types";
import { ApiError } from "../src/types/errors";
import type { StockRange, StockTimeSeries } from "../src/types/stock";

const CAPS = {
  id: "mock" as const,
  label: "test",
  requiresNetwork: false,
  requiresApiKey: false,
  isMock: true,
  supportedRanges: ["1m", "3m", "6m", "1y"] as StockRange[],
  maxLookbackTradingDays: 1000,
};

function series(ticker = "AAA"): StockTimeSeries {
  return {
    ticker,
    range: "3m",
    currency: null,
    timezone: null,
    lastRefreshed: null,
    priceBasis: "close",
    bars: [
      { date: "2025-01-02", open: 1, high: 1, low: 1, close: 1, adjustedClose: null, volume: 1 },
    ],
    warnings: [],
  };
}

function fakeProvider(
  fetchImpl: MarketDataProvider["fetchDailySeries"]
): MarketDataProvider {
  return { capabilities: CAPS, fetchDailySeries: fetchImpl };
}

describe("withTimeout", () => {
  it("rejects with PROVIDER_TIMEOUT when the underlying call exceeds the budget", async () => {
    const provider = fakeProvider(() => new Promise<StockTimeSeries>(() => {}));
    const wrapped = withTimeout(provider, 10);
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
  });

  it("returns the result when it settles in time and preserves capabilities", async () => {
    const provider = fakeProvider(async () => series());
    const wrapped = withTimeout(provider, 1000);
    expect(wrapped.capabilities).toBe(CAPS);
    await expect(wrapped.fetchDailySeries("AAA", "3m")).resolves.toMatchObject({ ticker: "AAA" });
  });

  it("is a no-op when timeoutMs <= 0", () => {
    const provider = fakeProvider(async () => series());
    expect(withTimeout(provider, 0)).toBe(provider);
  });
});

describe("createRateLimiter", () => {
  it("allows up to maxCalls within the window, then refuses, then recovers", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ maxCalls: 2, windowMs: 1_000, now: () => t });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false); // saturated
    t += 1_001; // slide past the window
    expect(limiter.tryAcquire()).toBe(true);
  });
});

describe("withRateLimit", () => {
  it("throws PROVIDER_RATE_LIMITED once the limiter is saturated", async () => {
    let t = 0;
    const provider = fakeProvider(async () => series());
    const wrapped = withRateLimit(provider, createRateLimiter({ maxCalls: 1, windowMs: 1_000, now: () => t }));
    await expect(wrapped.fetchDailySeries("AAA", "3m")).resolves.toBeDefined();
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });
});

describe("createCircuitBreaker", () => {
  it("opens after the failure threshold and half-opens after the cooldown", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1_000, now: () => t });
    expect(breaker.state()).toBe("closed");
    breaker.acquire()!.failure();
    expect(breaker.state()).toBe("closed");
    breaker.acquire()!.failure();
    expect(breaker.state()).toBe("open");
    expect(breaker.acquire()).toBeNull(); // open: nothing admitted
    t += 1_000; // cooldown elapsed
    expect(breaker.state()).toBe("half-open");
    const probe = breaker.acquire();
    expect(probe).not.toBeNull();
    probe!.success();
    expect(breaker.state()).toBe("closed");
  });

  it("re-opens when a half-open trial fails", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => t });
    breaker.acquire()!.failure();
    expect(breaker.state()).toBe("open");
    t += 100;
    const probe = breaker.acquire(); // arms the single trial
    expect(probe).not.toBeNull();
    probe!.failure(); // trial fails
    expect(breaker.state()).toBe("open");
  });

  it("admits only ONE probe when several requests race in after the cooldown", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => t });
    breaker.acquire()!.failure(); // -> open
    t += 100; // -> half-open
    const granted = [breaker.acquire(), breaker.acquire(), breaker.acquire()].filter(Boolean);
    expect(granted).toHaveLength(1); // exactly one concurrent probe admitted
  });

  it("rejects a second half-open request until the in-flight probe settles", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => t });
    breaker.acquire()!.failure(); // -> open
    t += 100; // -> half-open
    const probe = breaker.acquire();
    expect(probe).not.toBeNull();
    expect(breaker.acquire()).toBeNull(); // 2nd is refused while the probe runs
    probe!.success(); // probe ok -> closed
    expect(breaker.state()).toBe("closed");
    expect(breaker.acquire()).not.toBeNull(); // normal requests allowed again
  });

  it("admits normal requests again after a successful probe", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: () => t });
    breaker.acquire()!.failure();
    breaker.acquire()!.failure(); // -> open
    t += 100; // -> half-open
    breaker.acquire()!.success(); // -> closed
    const a = breaker.acquire();
    const b = breaker.acquire();
    expect(a).not.toBeNull(); // closed state admits all callers (no single-probe gate)
    expect(b).not.toBeNull();
  });

  it("re-opens after a failed probe and grants a FRESH probe on the next cooldown (no lingering trial)", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => t });
    breaker.acquire()!.failure(); // -> open
    t += 100; // -> half-open
    breaker.acquire()!.failure(); // probe fails (e.g. timeout) -> re-open, trial cleared
    expect(breaker.state()).toBe("open");
    t += 100; // -> half-open again
    const fresh = breaker.acquire();
    expect(fresh).not.toBeNull(); // a brand-new probe is admitted, not blocked by a stale trial
  });

  it("ignores a stale probe completion so it cannot corrupt a newer trial", () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => t });
    breaker.acquire()!.failure(); // -> open
    t += 100; // -> half-open
    const stale = breaker.acquire()!; // probe P1
    stale.success(); // P1 ok -> closed
    breaker.acquire()!.failure(); // -> open again
    t += 100; // -> half-open
    const fresh = breaker.acquire()!; // probe P2 (a NEW trial)
    stale.failure(); // a late/duplicate settle of P1 must be ignored
    expect(breaker.state()).toBe("half-open"); // P2's trial is intact
    fresh.success();
    expect(breaker.state()).toBe("closed");
  });
});

describe("withCircuitBreaker — half-open single-probe under concurrency", () => {
  it("lets only ONE concurrent request reach the recovering provider after cooldown", async () => {
    let t = 0;
    let calls = 0;
    let mode: "fail" | "hang" = "fail";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (mode === "fail") throw new ApiError(502, "PROVIDER_UNAVAILABLE", "down");
      await gate; // hold the probe open so concurrent callers race the half-open gate
      return series();
    });
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 100, now: () => t });
    const wrapped = withCircuitBreaker(fakeProvider(fetchImpl), breaker);

    // Trip the breaker open, then advance past the cooldown into half-open.
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toBeDefined();
    calls = 0;
    mode = "hang";
    t += 100;

    // Fire several concurrent requests WITHOUT awaiting: exactly one probe is
    // admitted and parks on the gate; the rest fail fast. Release, THEN await.
    const pending = [
      wrapped.fetchDailySeries("AAA", "3m"),
      wrapped.fetchDailySeries("AAA", "3m"),
      wrapped.fetchDailySeries("AAA", "3m"),
    ];
    release(); // let the single admitted probe complete
    const settled = await Promise.allSettled(pending);

    expect(calls).toBe(1); // only ONE probe reached the provider
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    }
  });

  it("keeps per-provider breakers isolated (one open circuit does not affect another)", async () => {
    let t = 0;
    const downImpl = vi.fn(async () => {
      throw new ApiError(502, "PROVIDER_UNAVAILABLE", "down");
    });
    const upImpl = vi.fn(async () => series("BBB"));
    const down = withCircuitBreaker(
      fakeProvider(downImpl),
      createCircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000, now: () => t })
    );
    const up = withCircuitBreaker(
      fakeProvider(upImpl),
      createCircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000, now: () => t })
    );

    await expect(down.fetchDailySeries("AAA", "3m")).rejects.toBeDefined(); // trips DOWN open
    await expect(down.fetchDailySeries("AAA", "3m")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    // The UP provider's breaker is unaffected and still serves normally.
    await expect(up.fetchDailySeries("BBB", "3m")).resolves.toMatchObject({ ticker: "BBB" });
    expect(upImpl).toHaveBeenCalledTimes(1);
  });
});

describe("withCircuitBreaker", () => {
  it("fails fast without calling the provider while the circuit is open", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => {
      throw new ApiError(502, "PROVIDER_UNAVAILABLE", "down");
    });
    const wrapped = withCircuitBreaker(
      fakeProvider(fetchImpl),
      createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1_000, now: () => t })
    );
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toBeDefined();
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Circuit now open: the next call short-circuits without touching the provider.
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("recovers after the cooldown on a successful half-open trial", async () => {
    let t = 0;
    let healthy = false;
    const fetchImpl = vi.fn(async () => {
      if (!healthy) throw new ApiError(502, "PROVIDER_UNAVAILABLE", "down");
      return series();
    });
    const wrapped = withCircuitBreaker(
      fakeProvider(fetchImpl),
      createCircuitBreaker({ failureThreshold: 1, cooldownMs: 500, now: () => t })
    );
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toBeDefined();
    t += 500;
    healthy = true;
    await expect(wrapped.fetchDailySeries("AAA", "3m")).resolves.toMatchObject({ ticker: "AAA" });
  });
});

describe("withInflightDedup", () => {
  it("coalesces concurrent same-key calls onto one underlying request", async () => {
    let resolveFn!: (s: StockTimeSeries) => void;
    const fetchImpl = vi.fn(
      () => new Promise<StockTimeSeries>((resolve) => {
        resolveFn = resolve;
      })
    );
    const wrapped = withInflightDedup(fakeProvider(fetchImpl));
    const p1 = wrapped.fetchDailySeries("aaa", "3m");
    const p2 = wrapped.fetchDailySeries("AAA", "3m"); // same after normalization
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFn(series());
    await Promise.all([p1, p2]);
    // A later call (after the first settled) hits the provider again.
    resolveFn = () => {};
    const p3 = wrapped.fetchDailySeries("AAA", "3m");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resolveFn(series());
    await p3;
  });

  it("does not coalesce different ranges", async () => {
    const fetchImpl = vi.fn(async () => series());
    const wrapped = withInflightDedup(fakeProvider(fetchImpl));
    await Promise.all([
      wrapped.fetchDailySeries("AAA", "1m"),
      wrapped.fetchDailySeries("AAA", "3m"),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("clears the entry after a rejection so a retry calls the provider again", async () => {
    const fetchImpl = vi
      .fn<MarketDataProvider["fetchDailySeries"]>()
      .mockRejectedValueOnce(new ApiError(502, "PROVIDER_UNAVAILABLE", "x"))
      .mockResolvedValueOnce(series());
    const wrapped = withInflightDedup(fakeProvider(fetchImpl));
    await expect(wrapped.fetchDailySeries("AAA", "3m")).rejects.toBeDefined();
    await expect(wrapped.fetchDailySeries("AAA", "3m")).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
