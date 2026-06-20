import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * A route handler that may return a promise. Express 5 forwards rejected
 * promises automatically, but wrapping keeps the behaviour explicit and
 * predictable across handlers (and independent of Express internals).
 */
type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler so any thrown error or rejected promise is
 * forwarded to the central error handler via `next(err)`.
 */
export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
