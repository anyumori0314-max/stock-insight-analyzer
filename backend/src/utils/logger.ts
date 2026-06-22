/**
 * Minimal structured logger (Phase 10).
 *
 * Emits one JSON object per line so logs are machine-parseable without pulling
 * in a logging framework. It is deliberately small and SAFE BY DESIGN:
 *
 *  - Callers pass only flat, primitive fields (no objects/Error instances), so a
 *    stack trace or nested provider payload cannot be logged by accident.
 *  - A denylist redacts any field whose KEY looks secret (apiKey, authorization,
 *    cookie, token, password, secret) even if one is passed by mistake.
 *  - String values are stripped of control characters (log-injection defense)
 *    and length-capped.
 *
 * The logger never reads `process.env`, the request body, or provider URLs, so
 * secrets and raw provider data cannot leak through it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogValue = string | number | boolean | null | undefined;
export interface LogFields {
  [key: string]: LogValue;
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Minimum level to emit (default "info"). */
  level?: LogLevel;
  /** When true, nothing is emitted (used in tests to keep output clean). */
  silent?: boolean;
  /** Injectable sink (tests). Defaults to stdout/stderr by level. */
  sink?: (level: LogLevel, line: string) => void;
  /** Injectable clock (tests). */
  now?: () => Date;
}

/** Keys that must never be logged in clear text, even if passed by mistake. */
const FORBIDDEN_KEY = /(authorization|cookie|api[-_]?key|apikey|token|password|secret)/i;

const MAX_VALUE_LENGTH = 512;

/**
 * Replaces ASCII control characters (C0 range + DEL) with a space — a
 * log-injection defense (no raw newlines/escapes) — and caps the length. A
 * char-code scan (not a regex with literal control bytes) keeps this source file
 * pure ASCII.
 */
function scrubValue(value: LogValue): LogValue {
  if (typeof value !== "string") {
    return value;
  }
  const limit = Math.min(value.length, MAX_VALUE_LENGTH);
  let out = "";
  for (let i = 0; i < limit; i += 1) {
    const code = value.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? " " : value[i];
  }
  return out;
}

function buildRecord(
  now: () => Date,
  level: LogLevel,
  event: string,
  fields?: LogFields
): Record<string, LogValue> {
  const record: Record<string, LogValue> = {
    timestamp: now().toISOString(),
    level,
    event,
  };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) {
        continue;
      }
      record[key] = FORBIDDEN_KEY.test(key) ? "[REDACTED]" : scrubValue(value);
    }
  }
  return record;
}

function defaultSink(level: LogLevel, line: string): void {
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minRank = LEVEL_RANK[options.level ?? "info"];
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? defaultSink;

  function emit(level: LogLevel, event: string, fields?: LogFields): void {
    if (options.silent || LEVEL_RANK[level] < minRank) {
      return;
    }
    sink(level, JSON.stringify(buildRecord(now, level, event, fields)));
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** A logger that drops everything — handy default for tests. */
export const silentLogger: Logger = createLogger({ silent: true });
