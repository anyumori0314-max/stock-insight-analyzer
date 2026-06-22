import type { RequestHandler } from "express";

import type { Logger } from "../utils/logger";

/**
 * Structured access logger (Phase 10).
 *
 * Logs exactly ONE record per request, on response `finish`, with only
 * safe fields:
 *   requestId, method, path, status, durationMs, and (when a handler set them)
 *   errorCode, ticker, cacheHit, source.
 *
 * Deliberately NOT logged: the query string (dropped entirely — it can carry
 * junk), request/response bodies, headers (Authorization/Cookie), the API key,
 * provider URLs/payloads, and stack traces. The path is the inbound pathname
 * only, control-char-stripped and length-capped.
 */
const MAX_PATH_LENGTH = 100;

/** Pathname with ASCII control characters removed and length-capped. */
function safePath(path: string): string {
  const limit = Math.min(path.length, MAX_PATH_LENGTH);
  let out = "";
  for (let i = 0; i < limit; i += 1) {
    const code = path.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += path[i];
    }
  }
  return out;
}

interface RequestLogLocals {
  errorCode?: string;
  ticker?: string;
  cacheHit?: boolean;
  source?: string;
}

export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    // Capture method/path/requestId NOW: routers rewrite `req.url` while routing,
    // and `originalUrl` is the stable original. Drop the query string entirely
    // (it can carry junk we never want logged).
    const method = req.method;
    const requestId = req.requestId;
    const path = safePath((req.originalUrl ?? req.url ?? "").split("?")[0] ?? "");

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const locals = res.locals as RequestLogLocals;
      const level = res.statusCode >= 500 ? "error" : "info";
      logger[level]("http.request", {
        requestId,
        method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
        errorCode: locals.errorCode,
        ticker: locals.ticker,
        cacheHit: locals.cacheHit,
        source: locals.source,
      });
    });
    next();
  };
}
