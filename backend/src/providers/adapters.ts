/**
 * Concrete {@link MarketDataProvider} adapters (Phase 19).
 *
 *   - Alpha Vantage : the live network client (needs a key; ~100 day lookback).
 *   - Mock          : deterministic, offline, no key, no network.
 *   - SQLite        : the local history store; offline; can serve any window it
 *                     holds data for. CSV is ingested INTO SQLite upstream, so the
 *                     read path is uniform.
 *
 * Each adapter only declares capabilities and forwards to an existing, already
 * hardened implementation — the raw provider body and API key remain hidden.
 */

import type { HistoricalDataService } from "../services/historicalDataService";
import {
  createAlphaVantageClient,
  type AlphaVantageClientOptions,
} from "../services/alphaVantageClient";
import {
  createMockStockDataProvider,
  MOCK_TRADING_DAYS,
} from "../services/mockStockDataProvider";
import { errorFor } from "../types/errors";
import { DEFAULT_RANGE, STOCK_RANGES } from "../types/stock";
import { rangesWithinLookback, type MarketDataProvider } from "./types";

/**
 * `outputsize=compact` returns the latest ~100 trading days, so Alpha Vantage can
 * fully back `1m` / `3m` but NOT `6m` / `1y` (those need the SQLite history).
 */
export const ALPHA_VANTAGE_COMPACT_TRADING_DAYS = 100;

export function createAlphaVantageProvider(
  options: AlphaVantageClientOptions
): MarketDataProvider {
  const client = createAlphaVantageClient(options);
  return {
    capabilities: {
      id: "alphaVantage",
      label: "Alpha Vantage (live)",
      requiresNetwork: true,
      requiresApiKey: true,
      isMock: false,
      supportedRanges: rangesWithinLookback(ALPHA_VANTAGE_COMPACT_TRADING_DAYS),
      maxLookbackTradingDays: ALPHA_VANTAGE_COMPACT_TRADING_DAYS,
    },
    fetchDailySeries: (ticker, range) => client.fetchDailySeries(ticker, range),
  };
}

export function createMockProvider(): MarketDataProvider {
  const client = createMockStockDataProvider();
  return {
    capabilities: {
      id: "mock",
      label: "Deterministic mock (offline)",
      requiresNetwork: false,
      requiresApiKey: false,
      isMock: true,
      supportedRanges: rangesWithinLookback(MOCK_TRADING_DAYS),
      maxLookbackTradingDays: MOCK_TRADING_DAYS,
    },
    fetchDailySeries: (ticker, range) => client.fetchDailySeries(ticker, range),
  };
}

export interface SqliteProviderOptions {
  historicalService: HistoricalDataService;
}

export function createSqliteProvider(options: SqliteProviderOptions): MarketDataProvider {
  const { historicalService } = options;
  return {
    capabilities: {
      id: "sqlite",
      label: "Local SQLite history (offline)",
      requiresNetwork: false,
      requiresApiKey: false,
      isMock: false,
      // Capability-wise it can serve any window; whether enough data exists for a
      // given window is decided at read time (and surfaced as a warning upstream).
      supportedRanges: STOCK_RANGES,
      maxLookbackTradingDays: Number.MAX_SAFE_INTEGER,
    },
    async fetchDailySeries(ticker, range = DEFAULT_RANGE) {
      const series = historicalService.getTimeSeries(ticker, range);
      if (!series || series.bars.length === 0) {
        throw errorFor("INSUFFICIENT_DATA", "sqlite-no-data");
      }
      return series;
    },
  };
}
