import type { ErrorCode } from "../types/errors";

/**
 * Semantic classification of the advisory envelopes Alpha Vantage returns with
 * HTTP 200 in place of data (`Error Message` / `Note` / `Information`).
 *
 * The classification is intentionally NOT key-name based: the same key can carry
 * very different meanings (an `Information` may be a rate-limit notice, a premium
 * entitlement message, or a maintenance notice). We normalize the message and
 * match on its content, combining the channel (key) only as a last-resort
 * fallback for unrecognized text.
 *
 * The raw provider message is used ONLY here, for internal classification — it is
 * never returned to clients (the caller maps the returned code to a fixed,
 * public-safe message via the error catalog).
 */

export type ProviderMessageChannel = "errorMessage" | "note" | "information";

function normalize(message: string | undefined): string {
  return (message ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Order of these tests encodes priority (see classifyProviderMessage).
const RATE_LIMIT =
  /rate limit|call frequency|request frequency|requests? per (day|minute|second)|per (day|minute)|daily (quota|limit)|call (volume|limit)|too many requests|thank you for using alpha vantage|standard api (call|rate) limit|higher api call|quota/;

const API_KEY =
  /api[\s-]?key|invalid key|apikey|entitlement|premium (endpoint|membership)|free tier|current (plan|subscription)|requires? .*(subscription|plan|membership)|not (available|included) (for|in|on|with) your|unsupported (function|endpoint|parameter)|subscribe to .*(plan|endpoint)/;

const SYMBOL =
  /invalid api call|invalid symbol|symbol .*(not found|invalid|unknown)|no data (for|found)|malformed|unknown symbol|does not exist|no (matching|price) data/;

const OUTAGE =
  /unavailable|maintenance|temporar|service (is )?(down|unavailable)|upstream|gateway|try again later|internal (server )?error/;

/**
 * Maps a provider advisory message to a public error code.
 *
 * Priority (first match wins):
 *   1. rate-limit  — explicit quota / frequency phrasing wins even when the
 *      message also mentions "premium" (AV's throttle notices invite upgrades).
 *   2. api-key / entitlement — invalid/missing key, premium endpoint, etc.
 *   3. symbol      — invalid call / unknown symbol / no data.
 *   4. outage      — maintenance / temporarily unavailable / upstream error.
 *   5. channel fallback for unrecognized text:
 *        - errorMessage -> SYMBOL_NOT_FOUND (AV's bad-call channel)
 *        - note         -> PROVIDER_RATE_LIMITED (AV's classic throttle channel)
 *        - information  -> PROVIDER_UNAVAILABLE (safe, non-committal default)
 */
export function classifyProviderMessage(
  channel: ProviderMessageChannel,
  rawMessage: string | undefined
): ErrorCode {
  const msg = normalize(rawMessage);

  if (RATE_LIMIT.test(msg)) return "PROVIDER_RATE_LIMITED";
  if (API_KEY.test(msg)) return "API_KEY_INVALID";
  if (SYMBOL.test(msg)) return "SYMBOL_NOT_FOUND";
  if (OUTAGE.test(msg)) return "PROVIDER_UNAVAILABLE";

  switch (channel) {
    case "errorMessage":
      return "SYMBOL_NOT_FOUND";
    case "note":
      return "PROVIDER_RATE_LIMITED";
    case "information":
    default:
      return "PROVIDER_UNAVAILABLE";
  }
}
