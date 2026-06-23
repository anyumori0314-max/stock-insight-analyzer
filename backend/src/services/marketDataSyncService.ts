import type { PriceBar } from "../domain/historical";
import type { SqlDatabase } from "../db/sqlite";
import type { PriceRepository } from "../repositories/priceRepository";
import type { SyncStateRepository } from "../repositories/syncStateRepository";
import { ApiError } from "../types/errors";
import { DEFAULT_RANGE, type StockRange, type StockTimeSeries } from "../types/stock";
import { isRealIsoDate } from "../utils/dates";
import { expectedLatestCompletedTradingDay } from "../utils/marketCalendar";
import type { Logger } from "../utils/logger";
import { silentLogger } from "../utils/logger";
import type { AlphaVantageClient } from "./alphaVantageClient";

/**
 * Decides whether to top up a ticker's SQLite history from the provider, and —
 * when it does — persists ONLY the genuinely new daily bars (Phase 13).
 *
 * DESIGN (never "fetch today's bar"):
 *   1. Read the latest stored trade date.
 *   2. If it is already at/after the most recent COMPLETED trading day, do NOT
 *      call the provider (result "skipped").
 *   3. Otherwise, if a sync was attempted within the staleness window, STILL do
 *      not call the provider — this both suppresses same-day re-fetches and
 *      guarantees no auto-retry after a rate-limit/timeout.
 *   4. Only then make EXACTLY ONE provider call. Validate the returned series,
 *      keep only dates NEWER than the latest stored one, and UPSERT just those
 *      (source "api") in a transaction.
 *
 * SAFETY: concurrent calls for the same ticker AND range are coalesced onto one
 * provider request (a different range runs independently); a provider failure
 * records a SAFE sync_state row (public error code +
 * sanitized message — never a key, body or stack) and persists NO bars, so the
 * caller can fall back to the existing stored data. Invalid provider data is
 * never written.
 */

export type SyncResultKind = "success" | "skipped" | "failed" | "no_data";

export interface SyncOutcome {
  result: SyncResultKind;
  /** Whether the provider was actually called this run. */
  providerCalled: boolean;
  /** Trade dates newly written this run (empty unless result === "success"). */
  syncedDates: string[];
  /** Public error code on failure (never an internal detail). */
  errorCode: string | null;
  /** Sanitized, user-safe message on failure. */
  safeErrorMessage: string | null;
  /** ISO instant of a successful provider sync, else null. */
  apiSyncedAt: string | null;
}

export interface MarketDataSyncService {
  sync(ticker: string, range?: StockRange): Promise<SyncOutcome>;
}

export interface MarketDataSyncOptions {
  provider: AlphaVantageClient;
  db: SqlDatabase;
  priceRepository: PriceRepository;
  syncStateRepository: SyncStateRepository;
  /** Suppress a re-attempt (and thus auto-retry) within this many hours. */
  staleAfterHours: number;
  now?: () => Date;
  logger?: Logger;
}

/**
 * Validates provider bars into persistable {@link PriceBar}s (source "api"). A
 * single inconsistent bar rejects the whole batch (returns null) so a malformed
 * provider payload is never partially stored.
 */
function toValidatedApiBars(series: StockTimeSeries): PriceBar[] | null {
  const out: PriceBar[] = [];
  for (const bar of series.bars) {
    if (!isRealIsoDate(bar.date)) return null;
    const { open, high, low, close, volume } = bar;
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) return null;
    if (high < low || high < open || high < close || low > open || low > close) return null;
    if (!Number.isSafeInteger(volume) || volume < 0) return null;
    if (bar.adjustedClose !== null && !(Number.isFinite(bar.adjustedClose) && bar.adjustedClose > 0)) {
      return null;
    }
    out.push({
      ticker: series.ticker,
      tradeDate: bar.date,
      open,
      high,
      low,
      close,
      adjustedClose: bar.adjustedClose,
      volume,
      currency: series.currency,
      source: "api",
    });
  }
  return out;
}

export function createMarketDataSyncService(
  options: MarketDataSyncOptions
): MarketDataSyncService {
  const { provider, db, priceRepository, syncStateRepository, staleAfterHours } = options;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? silentLogger;

  // Coalesce concurrent syncs for the SAME (ticker, range) onto a single provider
  // request. The key is the normalized `${ticker}:${range}`, so a different range
  // (e.g. "1m" vs "3m") never shares another range's in-flight promise.
  const inflight = new Map<string, Promise<SyncOutcome>>();

  /** Canonical ticker form (matches tickerSchema: trim + uppercase). */
  function normalizeTicker(ticker: string): string {
    return ticker.trim().toUpperCase();
  }

  function withinWindow(lastAttemptAt: string | null, reference: Date): boolean {
    if (!lastAttemptAt) return false;
    const last = Date.parse(lastAttemptAt);
    if (!Number.isFinite(last)) return false;
    return reference.getTime() - last < staleAfterHours * 60 * 60 * 1000;
  }

  async function doSync(ticker: string, range: StockRange): Promise<SyncOutcome> {
    const reference = now();
    const nowIso = reference.toISOString();
    const latestStored = priceRepository.getLatestTradeDate(ticker);
    const expected = expectedLatestCompletedTradingDay(reference);

    // 2. Already current -> never call the provider.
    if (latestStored !== null && latestStored >= expected) {
      syncStateRepository.recordAttempt({
        ticker,
        attemptAt: nowIso,
        result: "skipped",
        latestTradeDate: latestStored,
      });
      logger.info("sync_skipped", { ticker, reason: "fresh" });
      return skipped();
    }

    // 3. Recent attempt -> suppress (no same-day re-fetch, no auto-retry).
    const state = syncStateRepository.get(ticker);
    if (withinWindow(state?.lastAttemptAt ?? null, reference)) {
      logger.info("sync_skipped", { ticker, reason: "recent_attempt" });
      return skipped();
    }

    // 4. Exactly one provider call.
    logger.info("sync_started", { ticker });
    let series: StockTimeSeries;
    try {
      series = await provider.fetchDailySeries(ticker, range);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "PROVIDER_UNAVAILABLE";
      const message =
        err instanceof ApiError ? err.message : "データ提供元に接続できませんでした。";
      syncStateRepository.recordAttempt({
        ticker,
        attemptAt: nowIso,
        result: "failed",
        latestTradeDate: latestStored,
        errorCode: code,
        safeErrorMessage: message,
      });
      logger.warn("sync_failed", { ticker, errorCode: code });
      return {
        result: "failed",
        providerCalled: true,
        syncedDates: [],
        errorCode: code,
        safeErrorMessage: message,
        apiSyncedAt: null,
      };
    }

    // Validate before persisting; never store a raw / malformed payload.
    const validated = toValidatedApiBars(series);
    if (validated === null) {
      syncStateRepository.recordAttempt({
        ticker,
        attemptAt: nowIso,
        result: "failed",
        latestTradeDate: latestStored,
        errorCode: "PROVIDER_RESPONSE_INVALID",
        safeErrorMessage: "データ提供元から想定外の応答がありました。",
      });
      logger.warn("sync_failed", { ticker, errorCode: "PROVIDER_RESPONSE_INVALID" });
      return {
        result: "failed",
        providerCalled: true,
        syncedDates: [],
        errorCode: "PROVIDER_RESPONSE_INVALID",
        safeErrorMessage: "データ提供元から想定外の応答がありました。",
        apiSyncedAt: null,
      };
    }

    // Keep ONLY dates newer than what we already store (never rewrite history).
    const newBars = validated.filter((b) => latestStored === null || b.tradeDate > latestStored);
    if (newBars.length === 0) {
      syncStateRepository.recordAttempt({
        ticker,
        attemptAt: nowIso,
        result: "success",
        latestTradeDate: latestStored,
        successAt: nowIso,
      });
      logger.info("sync_completed", { ticker, rowsInserted: 0 });
      return {
        result: "success",
        providerCalled: true,
        syncedDates: [],
        errorCode: null,
        safeErrorMessage: null,
        apiSyncedAt: nowIso,
      };
    }

    try {
      db.transaction(() => priceRepository.upsertBars(newBars, nowIso, nowIso));
    } catch {
      syncStateRepository.recordAttempt({
        ticker,
        attemptAt: nowIso,
        result: "failed",
        latestTradeDate: latestStored,
        errorCode: "PROVIDER_RESPONSE_INVALID",
        safeErrorMessage: "保存時にエラーが発生しました。",
      });
      logger.error("sync_failed", { ticker, reason: "db_error" });
      return {
        result: "failed",
        providerCalled: true,
        syncedDates: [],
        errorCode: "PROVIDER_RESPONSE_INVALID",
        safeErrorMessage: "保存時にエラーが発生しました。",
        apiSyncedAt: null,
      };
    }

    const newLatest = newBars[newBars.length - 1].tradeDate;
    syncStateRepository.recordAttempt({
      ticker,
      attemptAt: nowIso,
      result: "success",
      latestTradeDate: newLatest,
      successAt: nowIso,
    });
    logger.info("sync_completed", { ticker, rowsInserted: newBars.length });
    return {
      result: "success",
      providerCalled: true,
      syncedDates: newBars.map((b) => b.tradeDate),
      errorCode: null,
      safeErrorMessage: null,
      apiSyncedAt: nowIso,
    };
  }

  function skipped(): SyncOutcome {
    return {
      result: "skipped",
      providerCalled: false,
      syncedDates: [],
      errorCode: null,
      safeErrorMessage: null,
      apiSyncedAt: null,
    };
  }

  return {
    async sync(ticker, range = DEFAULT_RANGE) {
      // Normalize once so callers passing differing case/whitespace coalesce onto
      // the same request, and the repository / provider always see the canonical
      // symbol. The dedup key is per (ticker, range).
      const normalizedTicker = normalizeTicker(ticker);
      const key = `${normalizedTicker}:${range}`;
      const existing = inflight.get(key);
      if (existing) {
        return existing;
      }
      const promise = doSync(normalizedTicker, range);
      inflight.set(key, promise);
      try {
        return await promise;
      } finally {
        // Always clear THIS key on success, failure or throw so a later request
        // can run again; a concurrent different-range key is untouched.
        inflight.delete(key);
      }
    },
  };
}
