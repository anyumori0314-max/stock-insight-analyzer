/**
 * Provider abstraction (Phase 19).
 *
 * A single, provider-agnostic contract that every market-data source implements:
 * the live Alpha Vantage client, the deterministic offline mock, and the local
 * SQLite history store. Everything downstream (the service, cache, report
 * builder, routes) depends ONLY on this contract, so swapping or composing
 * sources (fallback, circuit-breaker, rate-limit, timeout, in-flight dedup) is a
 * localized change.
 *
 * CSV is intentionally NOT a provider here: it is the INGESTION entry point into
 * SQLite (see `csvImportService` / the `data:import` & `data:backfill` CLIs), and
 * is then served through the SQLite provider. So the read path stays uniform.
 *
 * INVARIANTS the contract preserves:
 *   - The raw provider body and the API key are never surfaced (the Alpha Vantage
 *     client already maps everything into the safe `ApiError` catalog).
 *   - A `mock` / `sqlite` provider performs ZERO network I/O.
 */

import type { StockRange, StockTimeSeries } from "../types/stock";
import { RANGE_TRADING_DAYS, STOCK_RANGES } from "../types/stock";

/** Stable identifier for a concrete provider (or a composed one). */
export type ProviderId = "alphaVantage" | "mock" | "sqlite" | "composite";

/**
 * Declarative description of what a provider can do. Used to route requests
 * (e.g. skip a provider that cannot honestly serve the requested window) and to
 * drive the UI's data-source / fallback notices. All fields are SAFE to surface.
 */
export interface ProviderCapabilities {
  id: ProviderId;
  /** Human-safe label (never a URL, key or path). */
  label: string;
  /** Does this provider make outbound network calls? mock / sqlite = false. */
  requiresNetwork: boolean;
  /** Does it need an API key to function at all? */
  requiresApiKey: boolean;
  /** Deterministic fake data (the UI flags it as non-real). */
  isMock: boolean;
  /** Windows this provider can FULLY back with real history. */
  supportedRanges: readonly StockRange[];
  /** How many trading days of history it can serve (large for SQLite). */
  maxLookbackTradingDays: number;
}

/**
 * The common market-data provider contract. `fetchDailySeries` returns the full
 * available series (the service slices it to the requested window), or throws a
 * catalog `ApiError`. The signature is intentionally identical to the legacy
 * `AlphaVantageClient`, so a provider is drop-in wherever a client was expected.
 */
export interface MarketDataProvider {
  readonly capabilities: ProviderCapabilities;
  fetchDailySeries(ticker: string, range?: StockRange): Promise<StockTimeSeries>;
}

/** The supported ranges whose required trading-day count fits within a lookback. */
export function rangesWithinLookback(maxLookbackTradingDays: number): StockRange[] {
  return STOCK_RANGES.filter((r) => RANGE_TRADING_DAYS[r] <= maxLookbackTradingDays);
}

/** True when the provider declares it can fully back `range`. */
export function supportsRange(provider: MarketDataProvider, range: StockRange): boolean {
  return provider.capabilities.supportedRanges.includes(range);
}

/**
 * Returns a new provider with the SAME capabilities but a replaced fetch
 * function. The shared helper every resilience decorator uses, so a wrapped
 * provider keeps advertising its underlying capabilities.
 */
export function decorate(
  provider: MarketDataProvider,
  fetchDailySeries: MarketDataProvider["fetchDailySeries"]
): MarketDataProvider {
  return { capabilities: provider.capabilities, fetchDailySeries };
}
