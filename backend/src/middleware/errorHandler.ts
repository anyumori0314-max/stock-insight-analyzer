import type { ErrorRequestHandler } from "express";
import { ApiError, type ErrorCode, type ErrorResponseBody } from "../types/errors";
import { silentLogger, type Logger } from "../utils/logger";

interface ErrorHandlerOptions {
  isDevelopment: boolean;
  /** Structured logger for safe error events. Defaults to silent (tests). */
  logger?: Logger;
}

/**
 * Safely classifies errors thrown by `express.json()` / body-parser.
 *
 * Detection does NOT rely on the `type` string alone: body-parser routes its
 * errors through `http-errors`, which guarantees `expose === true` and a
 * numeric `status`/`statusCode`, plus a type-specific discriminator
 * (`body` for parse failures, `limit` for size failures). Requiring all of
 * these means a plain `Error` that merely had a `type` field attached
 * (`Object.assign(new Error(), { type: "entity.parse.failed" })`) is NOT
 * misclassified and falls through to a generic 500.
 *
 * The internal `err.message` (which can include a snippet of the request body)
 * is never read or returned. We emit our own fixed, public-safe message so no
 * internal detail leaks — in development or production.
 */
function classifyBodyParserError(
  err: unknown
): { status: number; code: ErrorCode; message: string } | null {
  if (!(err instanceof Error)) {
    return null;
  }
  const candidate = err as Error & {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
    body?: unknown;
    limit?: unknown;
  };

  // http-errors marks client errors as exposable and sets a numeric status.
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;
  if (candidate.expose !== true || status === undefined) {
    return null;
  }

  // Invalid JSON: parse failures carry the raw `body` string.
  if (candidate.type === "entity.parse.failed" && status === 400 && typeof candidate.body === "string") {
    return { status: 400, code: "INVALID_JSON", message: "The request body contains invalid JSON." };
  }
  // Oversized body: size failures carry a numeric `limit`.
  if (candidate.type === "entity.too.large" && status === 413 && typeof candidate.limit === "number") {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." };
  }
  return null;
}

/**
 * Central error handler producing the unified error contract.
 *
 * - Known `ApiError`s map to their status/code/message.
 * - Body-parser failures (invalid JSON, oversized body) map to stable public
 *   codes with our own messages (never the parser's internal text).
 * - Any other error becomes a generic 500 so internal details (messages,
 *   stack traces, paths) are never exposed to clients.
 * - `details` is only attached in development.
 */
export function createErrorHandler({
  isDevelopment,
  logger = silentLogger,
}: ErrorHandlerOptions): ErrorRequestHandler {
  return (err, req, res, next) => {
    // If the response already started, defer to Express' default handling.
    if (res.headersSent) {
      next(err);
      return;
    }

    // Correlation id (set by the requestId middleware). Safe to echo: it is
    // either a freshly generated UUID or a validated, allow-listed client value.
    const requestId = req.requestId;

    if (err instanceof ApiError) {
      // Record the public code so the access logger can include it.
      res.locals.errorCode = err.code;
      const body: ErrorResponseBody = {
        error: {
          code: err.code,
          message: err.message,
        },
      };
      if (requestId) {
        body.error.requestId = requestId;
      }
      if (isDevelopment && err.details !== undefined) {
        body.error.details = err.details;
      }
      res.status(err.status).json(body);
      return;
    }

    // Body-parser errors carry a stable `type`; map them to public-safe codes.
    const bodyParserError = classifyBodyParserError(err);
    if (bodyParserError) {
      res.locals.errorCode = bodyParserError.code;
      const body: ErrorResponseBody = {
        error: {
          code: bodyParserError.code,
          message: bodyParserError.message,
        },
      };
      if (requestId) {
        body.error.requestId = requestId;
      }
      res.status(bodyParserError.status).json(body);
      return;
    }

    // Unexpected error. NEVER pass the raw Error to console.error: its message,
    // stack and any embedded local absolute paths / secrets must not be logged,
    // in development OR production. Instead emit a structured event carrying only
    // safe, flat fields (the logger's type signature physically prevents passing
    // an Error/stack, and a denylist redacts secret-looking keys). The access
    // logger additionally records the same status + errorCode on response finish.
    res.locals.errorCode = "INTERNAL_SERVER_ERROR";
    logger.error("error.unhandled", {
      requestId,
      status: 500,
      errorCode: "INTERNAL_SERVER_ERROR",
    });

    const body: ErrorResponseBody = {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    };
    if (requestId) {
      body.error.requestId = requestId;
    }
    res.status(500).json(body);
  };
}
