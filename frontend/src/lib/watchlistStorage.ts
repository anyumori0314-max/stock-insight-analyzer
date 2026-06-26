import { z } from "zod";

import { DEFAULT_RANGE, isStockRange, type StockRange } from "./ranges";
import { validateTicker } from "./tickers";

/**
 * Versioned, validated persistence for the user's watchlist (Phase 17).
 *
 * Everything the user curates — their ordered list of tickers, the selected
 * ticker and window — is stored in `localStorage` so it survives a browser
 * restart. The module is defensive BY DESIGN:
 *
 *  - A schema `version` is stored; a mismatch (or any corrupt / malformed value)
 *    is migrated or reset to a clean default rather than crashing the app.
 *  - The raw value is parsed through a Zod schema that STRIPS unknown fields, so
 *    a tampered/foreign payload can never inject extra state into the app.
 *  - Tickers are re-validated, trimmed, uppercased and de-duplicated, and the
 *    list is capped, so nothing the backend would reject (or an oversized list)
 *    is ever loaded.
 *  - Reads NEVER throw (a `try/catch` plus per-field fallbacks); writes report a
 *    structured failure (quota / unavailable) so the UI can warn while the app
 *    keeps working from in-memory state.
 *  - The persisted/exported shape contains ONLY the watchlist, selection and
 *    window — never an API key or any internal setting — so an export leaks
 *    nothing sensitive.
 */

export const WATCHLIST_STORAGE_KEY = "stock-insight.watchlist";
export const WATCHLIST_SCHEMA_VERSION = 1;
/** Hard cap on stored tickers, to bound storage and the number of open windows. */
export const MAX_WATCHLIST_TICKERS = 20;

export interface WatchlistState {
  watchlist: string[];
  selectedTicker: string | null;
  selectedRange: StockRange;
}

export interface PersistedWatchlist extends WatchlistState {
  version: number;
  updatedAt: string;
}

export type SaveFailureReason = "unavailable" | "quota" | "unknown";
export type SaveResult = { ok: true } | { ok: false; reason: SaveFailureReason };
export type ImportResult =
  | { ok: true; state: WatchlistState }
  | { ok: false; error: string };

/**
 * Lenient parse schema: unknown keys are stripped (Zod object default), and each
 * field has a forgiving type so a single bad field does not discard the whole
 * payload — the post-parse `sanitize` step enforces the real invariants.
 */
const rawSchema = z.object({
  version: z.number(),
  watchlist: z.array(z.unknown()).catch([]),
  selectedTicker: z.union([z.string(), z.null()]).catch(null),
  selectedRange: z.string().catch(DEFAULT_RANGE),
  updatedAt: z.string().optional(),
});

export function defaultWatchlistState(): WatchlistState {
  return { watchlist: [], selectedTicker: null, selectedRange: DEFAULT_RANGE };
}

/**
 * Validates, normalizes (trim + uppercase), de-duplicates and caps a raw ticker
 * list. Anything the shared `validateTicker` rejects is dropped silently — the
 * stored list is only ever a clean subset.
 */
export function sanitizeTickers(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const result = validateTicker(item);
    if (!result.ok || !result.value) continue;
    if (seen.has(result.value)) continue;
    seen.add(result.value);
    out.push(result.value);
    if (out.length >= MAX_WATCHLIST_TICKERS) break;
  }
  return out;
}

/** Reconciles a parsed payload into a clean {@link WatchlistState}. */
function sanitizeState(raw: z.infer<typeof rawSchema>): WatchlistState {
  const watchlist = sanitizeTickers(raw.watchlist);
  const selectedRange = isStockRange(raw.selectedRange) ? raw.selectedRange : DEFAULT_RANGE;
  let selectedTicker: string | null = null;
  if (typeof raw.selectedTicker === "string") {
    const normalized = raw.selectedTicker.trim().toUpperCase();
    if (watchlist.includes(normalized)) {
      selectedTicker = normalized;
    }
  }
  // Fall back to the first watchlist entry so a restored list always has a
  // sensible active ticker (the app may still re-derive this).
  if (selectedTicker === null && watchlist.length > 0) {
    selectedTicker = watchlist[0];
  }
  return { watchlist, selectedTicker, selectedRange };
}

/**
 * Coerces an arbitrary parsed value into a clean state, or null when it is
 * fundamentally unusable (wrong shape, or a future/unknown schema version that
 * we choose not to migrate). For v1 there is no prior version to migrate FROM.
 */
function coerce(raw: unknown): WatchlistState | null {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  if (parsed.data.version !== WATCHLIST_SCHEMA_VERSION) {
    // Migration hook for future versions. v1 has no predecessor, so an unknown
    // version is treated as incompatible and the caller resets/ignores it.
    return null;
  }
  return sanitizeState(parsed.data);
}

/** Probe whether `localStorage` is usable (private mode / disabled can throw). */
export function isLocalStorageAvailable(): boolean {
  try {
    const probe = "__wl_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the persisted watchlist, ALWAYS returning a usable state. Corrupt JSON,
 * an unknown schema version, an unavailable store, or any other problem yields the
 * clean default instead of throwing.
 */
export function loadWatchlistState(): WatchlistState {
  if (!isLocalStorageAvailable()) {
    return defaultWatchlistState();
  }
  let rawText: string | null;
  try {
    rawText = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
  } catch {
    return defaultWatchlistState();
  }
  if (!rawText) {
    return defaultWatchlistState();
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return defaultWatchlistState();
  }
  return coerce(parsedJson) ?? defaultWatchlistState();
}

/** Serializes a state to the persisted JSON shape (export-safe). */
export function serializeWatchlist(state: WatchlistState, now: () => Date = () => new Date()): string {
  const persisted: PersistedWatchlist = {
    version: WATCHLIST_SCHEMA_VERSION,
    watchlist: state.watchlist,
    selectedTicker: state.selectedTicker,
    selectedRange: state.selectedRange,
    updatedAt: now().toISOString(),
  };
  return JSON.stringify(persisted, null, 2);
}

/**
 * Persists the state, reporting a structured failure rather than throwing so the
 * UI can announce it while continuing from in-memory state. It writes directly
 * (no separate availability probe) so a genuine quota failure is reported as
 * `quota` rather than being masked as `unavailable` by a probe write.
 */
export function saveWatchlistState(
  state: WatchlistState,
  now: () => Date = () => new Date()
): SaveResult {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ok: false, reason: "unavailable" };
    }
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, serializeWatchlist(state, now));
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException) {
      if (
        err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        /quota/i.test(err.name)
      ) {
        return { ok: false, reason: "quota" };
      }
      if (err.name === "SecurityError") {
        return { ok: false, reason: "unavailable" };
      }
    }
    return { ok: false, reason: "unknown" };
  }
}

/**
 * Validates a user-provided JSON string for import. The same schema + sanitize
 * pipeline is applied BEFORE anything reaches the app, so an import can never
 * inject unknown fields or an unsupported version.
 */
export function parseImportedWatchlist(jsonText: string): ImportResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "JSONとして解析できませんでした。" };
  }
  const parsed = rawSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: "ウォッチリストの形式が正しくありません。" };
  }
  if (parsed.data.version !== WATCHLIST_SCHEMA_VERSION) {
    return { ok: false, error: "対応していないバージョンのデータです。" };
  }
  return { ok: true, state: sanitizeState(parsed.data) };
}
