import type { PriceBar } from "../domain/historical";
import { tickerSchema } from "../schemas/stock";
import { isRealIsoDate } from "../utils/dates";

/**
 * Pure CSV parsing + validation for daily price bars. NO database, NO filesystem
 * and NO network — it turns text into validated {@link PriceBar}s (source "csv")
 * or SAFE, line-numbered errors. The import service decides what to persist.
 *
 * Standard columns (header names are trimmed before matching):
 *   required: ticker, date, open, high, low, close, volume
 *   optional: adjusted_close, currency
 *
 * Validation policy mirrors the live provider's: a single bad cell rejects that
 * ROW (reported with a safe reason); the import service then refuses to persist
 * ANYTHING if any row failed, so a partially-valid file never half-imports.
 *
 * SECURITY:
 *  - Every reported reason is generated text or a SANITIZED cell value, so a CSV
 *    formula-injection payload (a cell starting with = + - @) can never be echoed
 *    back verbatim into a log or response.
 *  - A row-count cap bounds work on a hostile/huge file (the byte cap is enforced
 *    by the caller before reading the file into memory).
 */

export interface CsvParseLimits {
  /** Hard cap on DATA rows (excludes the header). */
  maxRows: number;
}

export interface PriceRowError {
  /** 1-based physical line number where the offending record begins. */
  line: number;
  /** Safe, human-readable reason (Japanese). Never contains a raw payload. */
  reason: string;
}

export interface CsvParseResult {
  /** Number of data rows seen (excludes header, excludes skipped blank lines). */
  rowsRead: number;
  /** Validated bars (meaningful only when `fatalError` is null AND `errors` is empty). */
  bars: PriceBar[];
  /** Row-level validation errors (safe). */
  errors: PriceRowError[];
  /** Header names present in the file that are not part of the spec (ignored). */
  unknownHeaders: string[];
  /** Whole-file problem (empty file, missing header, row cap). Aborts the import. */
  fatalError: string | null;
}

const REQUIRED_HEADERS = ["ticker", "date", "open", "high", "low", "close", "volume"] as const;
const OPTIONAL_HEADERS = ["adjusted_close", "currency"] as const;
const KNOWN_HEADERS = new Set<string>([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]);

/** Leading characters a spreadsheet may interpret as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const MAX_CELL_ECHO = 32;

/**
 * Renders a cell value safe to embed in a message: strips control characters,
 * neutralizes a leading formula trigger with a `'` guard, and caps the length.
 */
function safeCell(value: string): string {
  let out = "";
  const limit = Math.min(value.length, MAX_CELL_ECHO);
  for (let i = 0; i < limit; i += 1) {
    const code = value.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? " " : value[i];
  }
  out = out.trim();
  if (FORMULA_PREFIX.test(out)) {
    out = `'${out}`;
  }
  if (value.length > MAX_CELL_ECHO) {
    out += "…";
  }
  return out;
}

/**
 * Splits CSV text into records (RFC 4180-ish: quoted fields may contain commas,
 * quotes (`""`) and newlines). Returns each record's fields plus the 1-based
 * physical line where it begins. A leading UTF-8 BOM is stripped.
 */
function parseRecords(text: string): { fields: string[]; line: number }[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { fields: string[]; line: number }[] = [];

  let field = "";
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let started = false; // whether the current record has any content yet

  const pushField = () => {
    fields.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // Skip a fully-blank record (e.g. a trailing newline or blank line).
    const blank = fields.length === 1 && fields[0] === "";
    if (!blank) {
      records.push({ fields, line: recordStartLine });
    }
    fields = [];
    started = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (!started && !inQuotes) {
      recordStartLine = line;
      started = true;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      // Swallow CR; handle the record on the following LF (or here if lone CR).
      if (input[i + 1] === "\n") {
        i += 1;
      }
      line += 1;
      pushRecord();
    } else if (ch === "\n") {
      line += 1;
      pushRecord();
    } else {
      field += ch;
    }
  }
  // Flush a final record with no trailing newline.
  if (started || field !== "" || fields.length > 0) {
    pushRecord();
  }
  return records;
}

function parseFiniteNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Reject anything Number() would coerce loosely (e.g. "" -> 0, "0x10", whitespace).
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses and validates price-bar CSV text. Never throws on bad DATA — bad rows
 * become entries in `errors`; only structural problems (empty file, missing
 * header, row cap exceeded) set `fatalError`.
 */
export function parsePriceCsv(content: string, limits: CsvParseLimits): CsvParseResult {
  const empty: CsvParseResult = {
    rowsRead: 0,
    bars: [],
    errors: [],
    unknownHeaders: [],
    fatalError: null,
  };

  const records = parseRecords(content);
  if (records.length === 0) {
    return { ...empty, fatalError: "CSVファイルが空です。" };
  }

  // --- Header ---------------------------------------------------------------
  const headerRecord = records[0];
  const headers = headerRecord.fields.map((h) => h.trim().toLowerCase());
  const headerIndex = new Map<string, number>();
  headers.forEach((h, idx) => {
    if (!headerIndex.has(h)) headerIndex.set(h, idx);
  });

  const missing = REQUIRED_HEADERS.filter((h) => !headerIndex.has(h));
  if (missing.length > 0) {
    return { ...empty, fatalError: `必須列が不足しています: ${missing.join(", ")}` };
  }
  const unknownHeaders = headers.filter((h) => h !== "" && !KNOWN_HEADERS.has(h));

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return { ...empty, unknownHeaders, fatalError: "データ行がありません。" };
  }
  if (dataRecords.length > limits.maxRows) {
    return {
      ...empty,
      unknownHeaders,
      fatalError: `行数が上限（${limits.maxRows}行）を超えています。`,
    };
  }

  const col = (record: string[], name: string): string => {
    const idx = headerIndex.get(name);
    return idx === undefined ? "" : (record[idx] ?? "");
  };

  const bars: PriceBar[] = [];
  const errors: PriceRowError[] = [];
  const seen = new Map<string, number>(); // "ticker|date" -> line of first occurrence

  for (const { fields, line } of dataRecords) {
    const addError = (reason: string) => errors.push({ line, reason });

    // ticker (reuse the canonical ticker validation + uppercasing).
    const tickerResult = tickerSchema.safeParse(col(fields, "ticker"));
    if (!tickerResult.success) {
      addError(`ティッカーが不正です（${safeCell(col(fields, "ticker"))}）。`);
      continue;
    }
    const ticker = tickerResult.data;

    const date = col(fields, "date").trim();
    if (!isRealIsoDate(date)) {
      addError(`日付が実在するYYYY-MM-DD形式ではありません（${safeCell(col(fields, "date"))}）。`);
      continue;
    }

    const open = parseFiniteNumber(col(fields, "open"));
    const high = parseFiniteNumber(col(fields, "high"));
    const low = parseFiniteNumber(col(fields, "low"));
    const close = parseFiniteNumber(col(fields, "close"));
    if (open === null || high === null || low === null || close === null) {
      addError("OHLC(open/high/low/close)に有限の数値でない値があります。");
      continue;
    }
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      addError("OHLCは正の数である必要があります。");
      continue;
    }
    if (high < low || high < open || high < close || low > open || low > close) {
      addError("OHLCの大小関係が不正です（high>=open,close,low かつ low<=open,close,high）。");
      continue;
    }

    const volumeRaw = col(fields, "volume").trim();
    const volume = parseFiniteNumber(volumeRaw);
    if (volume === null || !Number.isSafeInteger(volume) || volume < 0) {
      addError("volumeは0以上の安全な整数である必要があります。");
      continue;
    }

    let adjustedClose: number | null = null;
    const adjRaw = col(fields, "adjusted_close").trim();
    if (adjRaw !== "") {
      const adj = parseFiniteNumber(adjRaw);
      if (adj === null || adj <= 0) {
        addError("adjusted_closeは空または正の有限数である必要があります。");
        continue;
      }
      adjustedClose = adj;
    }

    let currency: string | null = null;
    const curRaw = col(fields, "currency").trim();
    if (curRaw !== "") {
      if (!/^[A-Za-z]{3}$/.test(curRaw)) {
        addError(`currencyが妥当な通貨コードではありません（${safeCell(curRaw)}）。`);
        continue;
      }
      currency = curRaw.toUpperCase();
    }

    const dupKey = `${ticker}|${date}`;
    const firstLine = seen.get(dupKey);
    if (firstLine !== undefined) {
      addError(`ticker+dateが重複しています（${ticker} ${date}, 先出: ${firstLine}行目）。`);
      continue;
    }
    seen.set(dupKey, line);

    bars.push({
      ticker,
      tradeDate: date,
      open,
      high,
      low,
      close,
      adjustedClose,
      volume,
      currency,
      source: "csv",
    });
  }

  return { rowsRead: dataRecords.length, bars, errors, unknownHeaders, fatalError: null };
}
