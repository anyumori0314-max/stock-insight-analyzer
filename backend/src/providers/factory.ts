/**
 * Provider factory (Phase 19).
 *
 * Assembles the right {@link MarketDataProvider} stack for a data mode:
 *
 *   mock       -> offline mock (no key, no network, no resilience needed).
 *   historical -> offline SQLite store only.
 *   live       -> resilient Alpha Vantage (timeout + rate-limit + circuit-breaker
 *                 + in-flight dedup).
 *   hybrid     -> fallback[ resilient Alpha Vantage, SQLite ] so a provider
 *                 failure degrades to the stored data; with no key it is SQLite
 *                 only (never a crash).
 *
 * Guarantees:
 *   - `mock` / `historical` perform ZERO network I/O.
 *   - The resilience stack and the API key live entirely behind this factory.
 */

import type { FetchLike } from "../services/alphaVantageClient";
import type { HistoricalDataService } from "../services/historicalDataService";
import type { StockDataMode } from "../types/stock";
import {
  createAlphaVantageProvider,
  createMockProvider,
  createSqliteProvider,
} from "./adapters";
import { createFallbackProvider, type FallbackHop } from "./fallback";
import {
  createCircuitBreaker,
  createRateLimiter,
  withCircuitBreaker,
  withInflightDedup,
  withRateLimit,
  withTimeout,
} from "./resilience";
import type { MarketDataProvider } from "./types";

export interface ResilienceConfig {
  /** Client-side quota guard. Default: 30 calls / 60s (a runaway guard; the
   * provider's own limit is the real cap and maps to PROVIDER_RATE_LIMITED). */
  rateLimit?: { maxCalls: number; windowMs: number };
  /** Open after N consecutive failures for `cooldownMs`. Default: 4 / 30s. */
  circuitBreaker?: { failureThreshold: number; cooldownMs: number };
  /** Optional OUTER timeout. The Alpha Vantage client already aborts internally,
   * so this is off by default to avoid leaving its abort racing a second timer. */
  timeoutMs?: number;
  /** Injectable clock for the limiter / breaker (tests). */
  now?: () => number;
}

const DEFAULT_RATE_LIMIT = { maxCalls: 30, windowMs: 60_000 };
const DEFAULT_CIRCUIT_BREAKER = { failureThreshold: 4, cooldownMs: 30_000 };

/**
 * Wraps a network provider with the standard resilience stack. Order matters:
 * dedup is OUTERMOST so a coalesced call does not double-count against the
 * limiter / breaker; the breaker sits above the limiter so an open circuit fails
 * fast without consuming a rate-limit token.
 */
export function applyResilience(
  provider: MarketDataProvider,
  config: ResilienceConfig = {}
): MarketDataProvider {
  let p = provider;
  if (config.timeoutMs && config.timeoutMs > 0) {
    p = withTimeout(p, config.timeoutMs);
  }
  const rl = config.rateLimit ?? DEFAULT_RATE_LIMIT;
  p = withRateLimit(p, createRateLimiter({ ...rl, now: config.now }));
  const cb = config.circuitBreaker ?? DEFAULT_CIRCUIT_BREAKER;
  p = withCircuitBreaker(p, createCircuitBreaker({ ...cb, now: config.now }));
  p = withInflightDedup(p);
  return p;
}

export interface CreateMarketDataProviderOptions {
  dataMode: StockDataMode;
  /** Alpha Vantage key (required for live; optional for hybrid). */
  apiKey?: string;
  timeoutMs?: number;
  maxPoints?: number;
  /** Injectable fetch (tests); forwarded to the Alpha Vantage client. */
  fetchFn?: FetchLike;
  /** Required for historical / hybrid (the SQLite read path). */
  historicalService?: HistoricalDataService;
  resilience?: ResilienceConfig;
  /** hybrid only: observe each fallback hop (safe fields only). */
  onFallback?: (hop: FallbackHop) => void;
}

function buildResilientAlphaVantage(
  options: CreateMarketDataProviderOptions
): MarketDataProvider {
  const av = createAlphaVantageProvider({
    apiKey: options.apiKey!,
    timeoutMs: options.timeoutMs,
    maxPoints: options.maxPoints,
    fetchFn: options.fetchFn,
  });
  return applyResilience(av, options.resilience);
}

export function createMarketDataProvider(
  options: CreateMarketDataProviderOptions
): MarketDataProvider {
  switch (options.dataMode) {
    case "mock":
      return createMockProvider();

    case "historical": {
      if (!options.historicalService) {
        throw new Error("historical mode requires a historicalService.");
      }
      return createSqliteProvider({ historicalService: options.historicalService });
    }

    case "hybrid": {
      if (!options.historicalService) {
        throw new Error("hybrid mode requires a historicalService.");
      }
      const sqlite = createSqliteProvider({ historicalService: options.historicalService });
      // Without a key, hybrid serves SQLite only — never a crash.
      if (!options.apiKey) {
        return sqlite;
      }
      return createFallbackProvider({
        providers: [buildResilientAlphaVantage(options), sqlite],
        onFallback: options.onFallback,
      });
    }

    case "live":
    default:
      // The caller guards live-without-key (the app boots and surfaces
      // API_KEY_MISSING at request time), so this is only reached WITH a key.
      return buildResilientAlphaVantage(options);
  }
}
