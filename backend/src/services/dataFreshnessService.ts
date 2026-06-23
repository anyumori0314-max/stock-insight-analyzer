import type { DataFreshness } from "../domain/historical";
import { expectedLatestCompletedTradingDay } from "../utils/marketCalendar";

/**
 * Computes a freshness verdict for stored data (Phase 13/15).
 *
 * "Stale" means the newest stored bar is BEHIND the most recent COMPLETED US
 * trading day (a calendar comparison, so a weekend/holiday gap is not mistaken
 * for staleness). `ageHours` is exposed for display only. Empty data is reported
 * as not-stale (there is simply nothing to be stale) so the UI can distinguish
 * "empty" from "old".
 */
export interface DataFreshnessService {
  compute(latestTradeDate: string | null, recordCount: number): DataFreshness;
}

export interface DataFreshnessOptions {
  now?: () => Date;
}

const MS_PER_HOUR = 60 * 60 * 1000;

export function createDataFreshnessService(options: DataFreshnessOptions = {}): DataFreshnessService {
  const now = options.now ?? (() => new Date());

  return {
    compute(latestTradeDate, recordCount) {
      if (latestTradeDate === null) {
        return { latestTradeDate: null, recordCount, stale: false, ageHours: null };
      }
      const reference = now();
      const expected = expectedLatestCompletedTradingDay(reference);
      const stale = latestTradeDate < expected;
      const latestMs = Date.parse(`${latestTradeDate}T00:00:00Z`);
      const ageHours = Number.isFinite(latestMs)
        ? Math.max(0, (reference.getTime() - latestMs) / MS_PER_HOUR)
        : null;
      return { latestTradeDate, recordCount, stale, ageHours };
    },
  };
}
