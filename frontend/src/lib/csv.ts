/**
 * CSV export helpers (Phase 20).
 *
 * Two safety concerns are handled here:
 *
 * 1. RFC-4180 quoting — a field containing a comma, double-quote, CR or LF is
 *    wrapped in double-quotes with internal quotes doubled.
 *
 * 2. CSV FORMULA INJECTION — a spreadsheet may execute a cell whose text starts
 *    with `=`, `+`, `-`, `@`, TAB or CR as a formula (e.g. `=cmd|'/c calc'!A1`).
 *    We neutralize such a cell by prefixing a single quote `'`, EXCEPT when the
 *    field is a well-formed plain number (so a legitimate negative like `-5.2`
 *    stays a number, not text). This is applied BEFORE RFC-4180 quoting.
 */

/** A field that is a plain (optionally signed) decimal number is never a formula. */
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

/** Characters that can start a spreadsheet formula. */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Neutralizes a leading formula trigger by prefixing a single quote, unless the
 * value is a plain number (which a spreadsheet treats as a number, not a
 * formula). Exported for unit testing.
 */
export function neutralizeFormula(value: string): string {
  if (value.length === 0) {
    return value;
  }
  if (FORMULA_TRIGGERS.has(value[0]) && !PLAIN_NUMBER.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Escapes a single CSV field: formula-neutralize, then RFC-4180 quote if needed. */
export function escapeCsvField(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = neutralizeFormula(raw);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Joins a 2-D array of cells into a CRLF-terminated CSV string. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

/**
 * Triggers a browser download of `content` as a file. Best-effort: a failure
 * (e.g. a non-DOM environment) is swallowed and reported via the return value so
 * the caller can show a notice instead of throwing. No-op outside the browser.
 */
export function downloadTextFile(filename: string, content: string, mime = "text/csv"): boolean {
  try {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      return false;
    }
    // Prepend a UTF-8 BOM so Excel reads multibyte (Japanese) headers correctly.
    const blob = new Blob(["﻿", content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
