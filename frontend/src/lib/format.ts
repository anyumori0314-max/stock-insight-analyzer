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

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return DASH;
  }
  return `$${formatNumber(value)}`;
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
