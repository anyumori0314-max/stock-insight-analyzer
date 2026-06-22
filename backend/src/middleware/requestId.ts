import { randomUUID } from "crypto";
import type { RequestHandler } from "express";

/**
 * Per-request correlation id (Phase 10).
 *
 * - If the client sends an `X-Request-Id` that is SAFE (short, `[A-Za-z0-9_-]`),
 *   we adopt it so a trace can be followed across a proxy. Anything else
 *   (too long, control chars, injection attempts) is ignored and we generate a
 *   fresh UUID — we never echo arbitrary client input back into headers/logs.
 * - The id is attached to `req.requestId`, returned in the `X-Request-Id`
 *   response header, and used by the logger and error handler.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id assigned by the requestId middleware. */
      requestId?: string;
    }
  }
}

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}
