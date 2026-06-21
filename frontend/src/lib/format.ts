/** Display helpers. All gracefully render `null`/`undefined` as an em dash. */

const DASH = "—";

export function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Percentage with an explicit sign, e.g. "+12.34%" / "-5.00%". */
export function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

/**
 * Formats a price using the report's currency.
 *
 * - `currency` known (e.g. "USD", "JPY") -> `Intl.NumberFormat` currency style.
 * - `currency` null/unknown -> a PLAIN number (no symbol). We never assume "$" /
 *   "USD": `TIME_SERIES_DAILY` does not report a currency, so guessing one would
 *   mislabel non-USD listings.
 * - An invalid/unsupported code falls back to the number plus the raw code, so
 *   we still never invent a symbol.
 */
export function formatPrice(
  value: number | null | undefined,
  currency: string | null = null,
  fractionDigits = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value);
    } catch {
      return `${formatNumber(value, fractionDigits)} ${currency}`;
    }
  }
  return formatNumber(value, fractionDigits);
}

/** Sign of a value as a CSS-friendly direction token (for coloring). */
export function changeDirection(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return "flat";
  }
  return value > 0 ? "up" : "down";
}

/** Arrow glyph for a direction — conveys sign without relying on color alone. */
export function directionSymbol(direction: "up" | "down" | "flat"): string {
  return direction === "up" ? "▲" : direction === "down" ? "▼" : "→";
}

/** Text label for a direction — for screen readers and color-blind users. */
export function directionLabel(direction: "up" | "down" | "flat"): string {
  return direction === "up" ? "上昇" : direction === "down" ? "下落" : "変わらず";
}
