import type { PriceRepository } from "../repositories/priceRepository";
import {
  DEFAULT_RANGE,
  MAX_RANGE_TRADING_DAYS,
  type DailyBar,
  type StockRange,
  type StockTimeSeries,
} from "../types/stock";

/**
 * Reads the SQLite history store and produces a provider-agnostic
 * {@link StockTimeSeries}, so the EXISTING report pipeline (`sliceSeriesToRange`
 * + `buildStockReport`) works unchanged for the historical/hybrid modes — only
 * the data source differs. NO network and NO mutation happen here.
 *
 * It pulls a bounded window of the most-recent bars (enough to cover any
 * supported analysis window plus the SMA50 lookback) so memory stays bounded even
 * when the store holds years of history; the service then slices to the requested
 * window exactly as the live path does.
 */
export interface HistoricalDataService {
  /** Returns the stored series for a ticker, or null when there is no data. */
  getTimeSeries(ticker: string, range: StockRange): StockTimeSeries | null;
}

export interface HistoricalDataServiceOptions {
  priceRepository: PriceRepository;
  /**
   * Max recent bars to read (bounds memory). Defaults to the largest supported
   * window (`1y` ~252 sessions) plus a lookback margin, so a `1y` request is
   * fully covered while a single read still bounds memory even for years of data.
   */
  fetchLimit?: number;
}

/** Cover the largest window (`1y`) with headroom for indicator lookback. */
const DEFAULT_FETCH_LIMIT = MAX_RANGE_TRADING_DAYS + 50;

export function createHistoricalDataService(
  options: HistoricalDataServiceOptions
): HistoricalDataService {
  const repo = options.priceRepository;
  const fetchLimit = Math.max(1, Math.floor(options.fetchLimit ?? DEFAULT_FETCH_LIMIT));

  return {
    getTimeSeries(ticker, range = DEFAULT_RANGE) {
      const bars = repo.getBars(ticker, fetchLimit);
      if (bars.length === 0) {
        return null;
      }
      const dailyBars: DailyBar[] = bars.map((bar) => ({
        date: bar.tradeDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        adjustedClose: bar.adjustedClose,
        volume: bar.volume,
      }));
      // Use the most recent non-null currency, if any was recorded.
      const currency = [...bars].reverse().find((b) => b.currency !== null)?.currency ?? null;
      const lastDate = bars[bars.length - 1].tradeDate;

      return {
        ticker,
        range,
        currency,
        // The store does not record an exchange time zone for a bar.
        timezone: null,
        lastRefreshed: lastDate,
        priceBasis: "close",
        bars: dailyBars,
        warnings: ["ローカル履歴データ（SQLite）を表示しています。"],
      };
    },
  };
}
