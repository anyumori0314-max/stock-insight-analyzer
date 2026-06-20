import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { ApiError } from "../types/errors";

export interface LimiterConfig {
  windowMs: number;
  limit: number;
}

/**
 * Builds a rate limiter that emits the unified error contract on 429 by
 * delegating to the central error handler instead of sending its own body.
 *
 * - `standardHeaders: "draft-7"` exposes the combined `RateLimit` and
 *   `RateLimit-Policy` headers (NOT the legacy per-field
 *   `RateLimit-Limit/Remaining/Reset`, which belong to draft-6 and stay off).
 * - On a throttled (429) response express-rate-limit emits `Retry-After`; we
 *   also set it explicitly here so its presence does not depend on internals.
 *
 * Each call returns an independent limiter with its own in-memory store, so
 * limiters never share state across app instances (important for test isolation).
 */
export function createLimiter({ windowMs, limit }: LimiterConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res, next) => {
      // `rateLimit` is attached at runtime by the middleware but not present on
      // Express' base Request type, so read it through a narrow cast.
      const resetTime = (req as unknown as { rateLimit?: { resetTime?: Date } }).rateLimit
        ?.resetTime;
      if (resetTime) {
        const seconds = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        res.setHeader("Retry-After", String(seconds));
      }
      next(new ApiError(429, "RATE_LIMITED", "Too many requests. Please try again later."));
    },
  });
}
