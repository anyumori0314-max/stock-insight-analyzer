/**
 * Numeric safety helpers.
 *
 * Indicator math can overflow to `Infinity` or produce `NaN` for pathological
 * inputs (huge prices, division by near-zero). `JSON.stringify` silently turns
 * those into `null`, which would hide the problem. These helpers make the
 * intent explicit: a non-finite result becomes a real `null` we can reason
 * about (and attach a warning to), never a smuggled-in `NaN`/`Infinity`.
 */

/** Returns the value if it is a finite number, otherwise `null`. */
export function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** True only for a finite, real number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Rounds to `digits` decimals, returning `null` for non-finite inputs. */
export function roundOrNull(value: number | null | undefined, digits = 4): number | null {
  const finite = finiteOrNull(value);
  if (finite === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(finite * factor) / factor;
}
