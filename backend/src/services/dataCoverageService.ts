import type { TickerCoverage } from "../domain/historical";
import type { ImportRunRepository } from "../repositories/importRunRepository";
import type { PriceRepository } from "../repositories/priceRepository";
import type { SyncStateRepository } from "../repositories/syncStateRepository";
import { RANGE_TRADING_DAYS, STOCK_RANGES, type StockRange } from "../types/stock";
import { countTradingDays, countTradingDaysInclusive } from "../utils/marketCalendar";

/**
 * Reports, per ticker, HOW MUCH history is stored and which analysis windows it
 * can honestly back (Phase 16). It is read-only and provider-agnostic: it only
 * combines the SQLite repositories and the trading-day calendar, never touching
 * the network. The output is SAFE to surface in an ops report or status endpoint.
 *
 * "Available ranges" is computed from the stored TRADING-day count (weekends,
 * holidays, duplicate, invalid and future dates excluded — see
 * {@link countTradingDays}) against each window's required trading-day count
 * (e.g. `1y` needs ~252 sessions), so a CSV padded with weekend rows can never be
 * mistaken for a full year. The operator can tell at a glance that, say, `6m` is
 * covered but `1y` is not yet — instead of a long window silently rendering a
 * truncated period. The report's shortfall warning uses the SAME judgment, so the
 * two never contradict.
 */
export interface DataCoverageService {
  /** Coverage for one ticker (zeroed when nothing is stored). */
  getCoverage(ticker: string): TickerCoverage;
  /** Coverage for every ticker that has at least one stored bar. */
  getAllCoverage(): TickerCoverage[];
}

export interface DataCoverageServiceOptions {
  priceRepository: PriceRepository;
  /** Optional — supplies the last completed CSV-import timestamp when present. */
  importRunRepository?: ImportRunRepository;
  /** Optional — supplies the last successful API-sync timestamp per ticker. */
  syncStateRepository?: SyncStateRepository;
  /** Injectable clock (tests); used to exclude future-dated bars. */
  now?: () => Date;
}

/** Windows fully backed by `tradingDayCount` trading sessions, shortest -> longest. */
function availableRangesFor(tradingDayCount: number): StockRange[] {
  return STOCK_RANGES.filter((range) => tradingDayCount >= RANGE_TRADING_DAYS[range]);
}

export function createDataCoverageService(
  options: DataCoverageServiceOptions
): DataCoverageService {
  const { priceRepository, importRunRepository, syncStateRepository } = options;
  const now = options.now ?? (() => new Date());

  function getCoverage(ticker: string): TickerCoverage {
    const normalized = ticker.trim().toUpperCase();
    const earliest = priceRepository.getEarliestTradeDate(normalized);
    const latest = priceRepository.getLatestTradeDate(normalized);
    const recordCount = priceRepository.countBars(normalized);

    // Honest availability is judged in TRADING days, not raw row count: weekend /
    // holiday / duplicate / invalid / future bars do not back a window.
    const tradingDayCount = countTradingDays(priceRepository.getTradeDates(normalized), {
      now: now(),
    });

    // Expected sessions across the stored span minus the sessions we actually have
    // (same trading-day basis), so the gap is genuinely missing business days. With
    // fewer than two bars there is no span, so nothing can be "missing".
    let missingTradingDays = 0;
    if (earliest && latest && recordCount > 0) {
      const expected = countTradingDaysInclusive(earliest, latest);
      missingTradingDays = Math.max(0, expected - tradingDayCount);
    }

    // The last COMPLETED CSV import is process-wide (the import runs are not keyed
    // by ticker); the API sync timestamp IS per-ticker.
    const lastCsvImportedAt = importRunRepository?.latestCompleted("csv")?.finishedAt ?? null;
    const lastApiSyncedAt = syncStateRepository?.get(normalized)?.lastSuccessAt ?? null;

    return {
      ticker: normalized,
      earliestTradeDate: earliest,
      latestTradeDate: latest,
      recordCount,
      availableRanges: availableRangesFor(tradingDayCount),
      missingTradingDays,
      lastCsvImportedAt,
      lastApiSyncedAt,
    };
  }

  return {
    getCoverage,
    getAllCoverage() {
      return priceRepository.listTickers().map((ticker) => getCoverage(ticker));
    },
  };
}
