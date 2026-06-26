/**
 * Resilience decorators for {@link MarketDataProvider} (Phase 19).
 *
 * Each decorator wraps a provider and returns a provider with the SAME
 * capabilities, so they compose freely:
 *
 *   withInflightDedup(withCircuitBreaker(withRateLimit(withTimeout(provider))))
 *
 * They are pure and deterministic under an injected clock, so the breaker /
 * limiter timing is unit-testable without real timers.
 */

import { errorFor } from "../types/errors";
import { DEFAULT_RANGE, type StockRange, type StockTimeSeries } from "../types/stock";
import { decorate, type MarketDataProvider } from "./types";

// ---------------------------------------------------------------------------
// Timeout: an OUTER time bound. Rejects with PROVIDER_TIMEOUT if the underlying
// fetch has not settled within `timeoutMs`. (The Alpha Vantage client already
// aborts its own request; this is belt-and-suspenders and also bounds the
// otherwise-instant mock/sqlite providers in tests.)
// ---------------------------------------------------------------------------
export function withTimeout(provider: MarketDataProvider, timeoutMs: number): MarketDataProvider {
  if (!(timeoutMs > 0)) {
    return provider;
  }
  return decorate(provider, (ticker, range) => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(errorFor("PROVIDER_TIMEOUT", "provider-timeout")), timeoutMs);
    });
    return Promise.race([provider.fetchDailySeries(ticker, range), timeout]).finally(() => {
      clearTimeout(timer);
    });
  });
}

// ---------------------------------------------------------------------------
// Rate limiter: a client-side sliding-window guard that fails fast with
// PROVIDER_RATE_LIMITED before a call would exceed `maxCalls` per `windowMs`.
// Protects the provider's scarce free-tier quota (and avoids hammering it).
// ---------------------------------------------------------------------------
export interface RateLimiterOptions {
  maxCalls: number;
  windowMs: number;
  /** Injectable monotonic-ish clock (ms). Defaults to Date.now. */
  now?: () => number;
}

export interface RateLimiter {
  /** Records and allows a call, or returns false when the window is saturated. */
  tryAcquire(): boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const maxCalls = Math.max(1, Math.floor(options.maxCalls));
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const now = options.now ?? (() => Date.now());
  const hits: number[] = [];
  return {
    tryAcquire() {
      const t = now();
      const cutoff = t - windowMs;
      while (hits.length > 0 && hits[0] <= cutoff) {
        hits.shift();
      }
      if (hits.length >= maxCalls) {
        return false;
      }
      hits.push(t);
      return true;
    },
  };
}

export function withRateLimit(
  provider: MarketDataProvider,
  limiter: RateLimiter
): MarketDataProvider {
  return decorate(provider, async (ticker, range) => {
    if (!limiter.tryAcquire()) {
      throw errorFor("PROVIDER_RATE_LIMITED", "client-rate-limit");
    }
    return provider.fetchDailySeries(ticker, range);
  });
}

// ---------------------------------------------------------------------------
// Circuit breaker: after `failureThreshold` consecutive failures the circuit
// OPENS and calls fail fast with PROVIDER_UNAVAILABLE for `cooldownMs`. After the
// cooldown it goes HALF-OPEN and admits EXACTLY ONE trial probe: success closes
// it, failure re-opens it. Stops a dead provider from being hammered (and burning
// quota / latency) while it is down.
//
// HALF-OPEN CONCURRENCY: when the cooldown elapses and several requests race into
// `acquire()` together, only the FIRST is admitted as the trial; every other is
// rejected (fail-fast) until that single probe settles. This prevents a thundering
// herd of parallel probes against a recovering provider (extra traffic, wasted
// quota, and success/failure races). Each admitted attempt is a ONE-SHOT handle
// tagged with a monotonic token, so a late / duplicate / superseded probe
// completion can never overwrite a newer trial's state.
// ---------------------------------------------------------------------------
export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

/**
 * A ONE-SHOT handle for a single admitted attempt. It must be settled exactly
 * once via {@link CircuitAttempt.success} or {@link CircuitAttempt.failure}.
 * Settling more than once — or after a newer half-open trial has superseded this
 * one — is silently ignored, so a slow/stale probe completion never corrupts the
 * breaker's current state.
 */
export interface CircuitAttempt {
  success(): void;
  failure(): void;
}

export interface CircuitBreaker {
  state(): CircuitState;
  /**
   * Returns a one-shot {@link CircuitAttempt} when a request may proceed, or
   * `null` when it must fail fast: the circuit is OPEN, or it is HALF-OPEN and a
   * single trial probe is already in flight. Only ONE half-open probe is ever
   * admitted at a time, even under concurrent callers.
   */
  acquire(): CircuitAttempt | null;
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const failureThreshold = Math.max(1, Math.floor(options.failureThreshold));
  const cooldownMs = Math.max(1, Math.floor(options.cooldownMs));
  const now = options.now ?? (() => Date.now());

  let failures = 0;
  let openedAt: number | null = null;
  // Non-null while a HALF-OPEN trial probe is in flight; holds that probe's
  // monotonic token so a stale handle (captured under an older token) is detected
  // and ignored when it finally settles.
  let trialToken: number | null = null;
  let nextToken = 1;

  function state(): CircuitState {
    if (openedAt === null) {
      return "closed";
    }
    return now() - openedAt >= cooldownMs ? "half-open" : "open";
  }

  function close(): void {
    failures = 0;
    openedAt = null;
    trialToken = null;
  }
  function open(): void {
    openedAt = now();
    failures = failureThreshold;
    trialToken = null;
  }

  return {
    state,
    acquire(): CircuitAttempt | null {
      const s = state();
      if (s === "open") {
        return null;
      }
      // For a half-open trial, admit only the FIRST caller; reject the rest until
      // the in-flight probe settles. A closed-state attempt has no token.
      let myToken: number | null = null;
      if (s === "half-open") {
        if (trialToken !== null) {
          return null;
        }
        myToken = nextToken;
        nextToken += 1;
        trialToken = myToken;
      }

      let settled = false;
      return {
        success() {
          if (settled) return;
          settled = true;
          // A superseded half-open probe (a newer trial has taken over): ignore.
          if (myToken !== null && trialToken !== myToken) return;
          close();
        },
        failure() {
          if (settled) return;
          settled = true;
          if (myToken !== null) {
            // Half-open probe outcome. Ignore a superseded/stale completion.
            if (trialToken !== myToken) return;
            open();
            return;
          }
          // Closed-state failure: accumulate toward the threshold.
          failures += 1;
          if (failures >= failureThreshold) {
            openedAt = now();
            trialToken = null;
          }
        },
      };
    },
  };
}

export function withCircuitBreaker(
  provider: MarketDataProvider,
  breaker: CircuitBreaker
): MarketDataProvider {
  return decorate(provider, async (ticker, range) => {
    const attempt = breaker.acquire();
    if (!attempt) {
      throw errorFor("PROVIDER_UNAVAILABLE", "circuit-open");
    }
    try {
      const result = await provider.fetchDailySeries(ticker, range);
      attempt.success();
      return result;
    } catch (err) {
      // Covers rejection, timeout and synchronous throws alike — the attempt is
      // always settled exactly once, so a trial never lingers "in flight".
      attempt.failure();
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// In-flight dedup: coalesce concurrent requests for the SAME (ticker, range)
// onto ONE underlying call. The key is the normalized `TICKER:range`, so a
// different range runs independently. The entry is always cleared in `finally`
// so a failure never poisons the map.
// ---------------------------------------------------------------------------
export function withInflightDedup(provider: MarketDataProvider): MarketDataProvider {
  const inflight = new Map<string, Promise<StockTimeSeries>>();
  return decorate(provider, (ticker, range = DEFAULT_RANGE) => {
    const key = dedupKey(ticker, range);
    const existing = inflight.get(key);
    if (existing) {
      return existing;
    }
    const promise = provider.fetchDailySeries(ticker, range).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  });
}

function dedupKey(ticker: string, range: StockRange): string {
  return `${ticker.trim().toUpperCase()}:${range}`;
}
