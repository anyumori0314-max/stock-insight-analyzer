import type { PriceBar, PriceSource } from "../domain/historical";
import { isPriceSource } from "../domain/historical";
import type { SqlDatabase, SqlStatement } from "../db/sqlite";

/**
 * Read/write access to the `price_bars` table — the SOURCE OF TRUTH for
 * historical daily bars.
 *
 * Every method uses fully-parameterized statements (`?` placeholders); a ticker
 * or date is NEVER concatenated into SQL. Writes are idempotent: {@link
 * PriceRepository.upsertBar} classifies each row as inserted / updated /
 * unchanged so re-importing the same data changes nothing and is reported as
 * such. Callers that need atomicity wrap a batch in `db.transaction(...)`.
 */

export type UpsertOutcome = "inserted" | "updated" | "unchanged";

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface PriceRepository {
  /** The newest stored `trade_date` for a ticker, or null when none exists. */
  getLatestTradeDate(ticker: string): string | null;
  /** The oldest stored `trade_date` for a ticker, or null when none exists. */
  getEarliestTradeDate(ticker: string): string | null;
  /** Number of stored bars for a ticker. */
  countBars(ticker: string): number;
  /**
   * Distinct stored `trade_date`s for a ticker, ascending. Lightweight (dates
   * only) so coverage can judge true trading-day availability without loading
   * full bars.
   */
  getTradeDates(ticker: string): string[];
  /** Distinct tickers that have at least one stored bar, ascending. */
  listTickers(): string[];
  /**
   * Stored bars for a ticker, ascending by date. With `limit`, returns the most
   * recent `limit` bars (still ascending) so charting/indicators iterate forward.
   */
  getBars(ticker: string, limit?: number): PriceBar[];
  /** Upserts one bar, returning whether it was inserted / updated / unchanged. */
  upsertBar(bar: PriceBar, importedAt: string, updatedAt: string): UpsertOutcome;
  /** Upserts many bars (caller controls the surrounding transaction). */
  upsertBars(bars: readonly PriceBar[], importedAt: string, updatedAt: string): UpsertCounts;
}

function rowToBar(row: Record<string, unknown>): PriceBar {
  const source = String(row.source);
  return {
    ticker: String(row.ticker),
    tradeDate: String(row.trade_date),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    adjustedClose: row.adjusted_close === null ? null : Number(row.adjusted_close),
    volume: Number(row.volume),
    currency: row.currency === null || row.currency === undefined ? null : String(row.currency),
    source: (isPriceSource(source) ? source : "csv") as PriceSource,
  };
}

/** True when the stored row already matches `bar` exactly (=> "unchanged"). */
function sameValues(existing: PriceBar, bar: PriceBar): boolean {
  return (
    existing.open === bar.open &&
    existing.high === bar.high &&
    existing.low === bar.low &&
    existing.close === bar.close &&
    existing.adjustedClose === bar.adjustedClose &&
    existing.volume === bar.volume &&
    existing.currency === bar.currency &&
    existing.source === bar.source
  );
}

export function createPriceRepository(db: SqlDatabase): PriceRepository {
  // Prepared once and reused; node:sqlite statements are positional-parameterized.
  const selectOne: SqlStatement = db.prepare(
    "SELECT ticker, trade_date, open, high, low, close, adjusted_close, volume, currency, source " +
      "FROM price_bars WHERE ticker = ? AND trade_date = ?"
  );
  const insertOne: SqlStatement = db.prepare(
    "INSERT INTO price_bars " +
      "(ticker, trade_date, open, high, low, close, adjusted_close, volume, currency, source, imported_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const updateOne: SqlStatement = db.prepare(
    "UPDATE price_bars SET open = ?, high = ?, low = ?, close = ?, adjusted_close = ?, " +
      "volume = ?, currency = ?, source = ?, updated_at = ? WHERE ticker = ? AND trade_date = ?"
  );
  const latest: SqlStatement = db.prepare(
    "SELECT MAX(trade_date) AS latest FROM price_bars WHERE ticker = ?"
  );
  const earliest: SqlStatement = db.prepare(
    "SELECT MIN(trade_date) AS earliest FROM price_bars WHERE ticker = ?"
  );
  const count: SqlStatement = db.prepare(
    "SELECT COUNT(*) AS n FROM price_bars WHERE ticker = ?"
  );
  const tradeDates: SqlStatement = db.prepare(
    "SELECT trade_date FROM price_bars WHERE ticker = ? ORDER BY trade_date ASC"
  );
  const distinctTickers: SqlStatement = db.prepare(
    "SELECT DISTINCT ticker FROM price_bars ORDER BY ticker ASC"
  );
  const allAsc: SqlStatement = db.prepare(
    "SELECT ticker, trade_date, open, high, low, close, adjusted_close, volume, currency, source " +
      "FROM price_bars WHERE ticker = ? ORDER BY trade_date ASC"
  );
  const recentAsc: SqlStatement = db.prepare(
    "SELECT ticker, trade_date, open, high, low, close, adjusted_close, volume, currency, source FROM (" +
      "SELECT ticker, trade_date, open, high, low, close, adjusted_close, volume, currency, source " +
      "FROM price_bars WHERE ticker = ? ORDER BY trade_date DESC LIMIT ?" +
      ") ORDER BY trade_date ASC"
  );

  function upsertBar(bar: PriceBar, importedAt: string, updatedAt: string): UpsertOutcome {
    const existingRow = selectOne.get(bar.ticker, bar.tradeDate);
    if (!existingRow) {
      insertOne.run(
        bar.ticker,
        bar.tradeDate,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.adjustedClose,
        bar.volume,
        bar.currency,
        bar.source,
        importedAt,
        updatedAt
      );
      return "inserted";
    }
    const existing = rowToBar(existingRow);
    if (sameValues(existing, bar)) {
      return "unchanged";
    }
    updateOne.run(
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.adjustedClose,
      bar.volume,
      bar.currency,
      bar.source,
      updatedAt,
      bar.ticker,
      bar.tradeDate
    );
    return "updated";
  }

  return {
    getLatestTradeDate(ticker) {
      const row = latest.get(ticker);
      const value = row?.latest;
      return value === null || value === undefined ? null : String(value);
    },
    getEarliestTradeDate(ticker) {
      const row = earliest.get(ticker);
      const value = row?.earliest;
      return value === null || value === undefined ? null : String(value);
    },
    countBars(ticker) {
      const row = count.get(ticker);
      return row ? Number(row.n) : 0;
    },
    getTradeDates(ticker) {
      return tradeDates.all(ticker).map((row) => String(row.trade_date));
    },
    listTickers() {
      return distinctTickers.all().map((row) => String(row.ticker));
    },
    getBars(ticker, limit) {
      const rows =
        limit !== undefined && limit >= 0
          ? recentAsc.all(ticker, limit)
          : allAsc.all(ticker);
      return rows.map(rowToBar);
    },
    upsertBar,
    upsertBars(bars, importedAt, updatedAt) {
      const counts: UpsertCounts = { inserted: 0, updated: 0, unchanged: 0 };
      for (const bar of bars) {
        const outcome = upsertBar(bar, importedAt, updatedAt);
        counts[outcome] += 1;
      }
      return counts;
    },
  };
}
