/**
 * FANG+ presets and client-side ticker validation.
 *
 * The validation mirrors the backend `tickerSchema` (ASCII allow-list applied
 * before uppercasing, length <= 10) so users get instant feedback, but the
 * server remains the source of truth and re-validates every request.
 */

export interface PresetTicker {
  symbol: string;
  name: string;
}

/**
 * "FANG+" REFERENCE preset — a convenience list of well-known mega-cap
 * technology leaders. This is NOT a reproduction of the official NYSE FANG+
 * index and is NOT guaranteed to match its latest constituents (which are
 * rebalanced periodically).
 *
 * Source (for the general FANG+ concept), last checked 2026-06-21:
 *   https://www.ice.com/fang
 * Update this list and the date above if the reference set is revised.
 */
export const FANG_PLUS_PRESETS: PresetTicker[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "NFLX", name: "Netflix" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "TSLA", name: "Tesla" },
];

/** Shown beside the preset list so users do not read it as the official index. */
export const FANG_PLUS_PRESET_NOTE =
  "公式指数（NYSE FANG+）の最新構成を保証するものではありません。構成銘柄は変更される可能性があります。";

const MAX_TICKER_LENGTH = 10;
// Same shape as the backend: 1+ alphanumerics with optional single `.`/`-`
// separators between alphanumeric groups (covers BRK.B, BF.A, BRK-B).
const TICKER_PATTERN = /^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/;

export interface TickerValidation {
  ok: boolean;
  /** Normalized (trimmed, uppercased) value when `ok`. */
  value?: string;
  /** Human-readable reason when not `ok`. */
  error?: string;
}

export function validateTicker(input: string): TickerValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "ティッカーを入力してください。" };
  }
  if (trimmed.length > MAX_TICKER_LENGTH) {
    return { ok: false, error: `ティッカーは${MAX_TICKER_LENGTH}文字以内で入力してください。` };
  }
  if (!TICKER_PATTERN.test(trimmed)) {
    return { ok: false, error: "使用できない文字が含まれています（英数字と . - のみ）。" };
  }
  return { ok: true, value: trimmed.toUpperCase() };
}
