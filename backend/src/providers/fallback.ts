/**
 * Fallback / composite provider (Phase 19).
 *
 * Tries an ordered list of providers and returns the first success. A provider
 * is SKIPPED (without a call) when it is capability-incapable of the requested
 * range; a provider that THROWS advances to the next. If every provider fails or
 * is skipped, the last error is re-thrown (or a generic PROVIDER_UNAVAILABLE).
 *
 * This is how `hybrid` mode degrades safely: try the live provider, fall back to
 * the local SQLite store on any failure. `onFallback` reports each hop with SAFE
 * fields only (provider ids + a public error code), so the UI can show that a
 * fallback occurred without leaking provider internals.
 */

import { ApiError, errorFor } from "../types/errors";
import { DEFAULT_RANGE, STOCK_RANGES, type StockRange } from "../types/stock";
import { supportsRange, type MarketDataProvider, type ProviderCapabilities } from "./types";

export interface FallbackHop {
  /** The provider that was skipped or failed. */
  fromId: string;
  /** The next provider that will be tried, or null when exhausted. */
  toId: string | null;
  reason: "unsupported" | "error";
  /** Public error code when `reason` is "error". Never an internal detail. */
  errorCode?: string;
}

export interface FallbackProviderOptions {
  providers: MarketDataProvider[];
  /** Skip a provider whose capabilities do not cover the range (default true). */
  capabilityAware?: boolean;
  /** Observability hook; receives SAFE fields only. */
  onFallback?: (hop: FallbackHop) => void;
}

function compositeCapabilities(providers: MarketDataProvider[]): ProviderCapabilities {
  return {
    id: "composite",
    label: providers.map((p) => p.capabilities.label).join(" → "),
    // The composite needs the network only if at least one member does.
    requiresNetwork: providers.some((p) => p.capabilities.requiresNetwork),
    // It needs a key only if EVERY member needs one (else an offline member can serve).
    requiresApiKey: providers.every((p) => p.capabilities.requiresApiKey),
    // It is "mock" only if every member is mock.
    isMock: providers.every((p) => p.capabilities.isMock),
    supportedRanges: STOCK_RANGES.filter((r) => providers.some((p) => supportsRange(p, r))),
    maxLookbackTradingDays: Math.max(
      ...providers.map((p) => p.capabilities.maxLookbackTradingDays)
    ),
  };
}

export function createFallbackProvider(options: FallbackProviderOptions): MarketDataProvider {
  const providers = options.providers;
  if (providers.length === 0) {
    throw new Error("createFallbackProvider requires at least one provider.");
  }
  const capabilityAware = options.capabilityAware ?? true;
  const capabilities = compositeCapabilities(providers);

  return {
    capabilities,
    async fetchDailySeries(ticker, range = DEFAULT_RANGE) {
      let lastError: unknown;
      for (let i = 0; i < providers.length; i += 1) {
        const provider = providers[i];
        const nextId = providers[i + 1]?.capabilities.id ?? null;

        if (capabilityAware && !supportsRange(provider, range as StockRange)) {
          options.onFallback?.({
            fromId: provider.capabilities.id,
            toId: nextId,
            reason: "unsupported",
          });
          continue;
        }

        try {
          return await provider.fetchDailySeries(ticker, range);
        } catch (err) {
          lastError = err;
          options.onFallback?.({
            fromId: provider.capabilities.id,
            toId: nextId,
            reason: "error",
            errorCode: err instanceof ApiError ? err.code : undefined,
          });
        }
      }
      // Re-throw the most recent real error so the caller sees a meaningful code;
      // only synthesize one if every provider was skipped on capability grounds.
      if (lastError !== undefined) {
        throw lastError;
      }
      throw errorFor("INSUFFICIENT_DATA", "fallback-no-capable-provider");
    },
  };
}
