import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import type { Env } from "./config/env";
import { createErrorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { createLimiter } from "./middleware/rateLimiter";
import { healthRouter } from "./routes/health";
import { stockRouter } from "./routes/stock";
import { ApiError } from "./types/errors";

const DEFAULT_DEV_ORIGIN = "http://localhost:5173";
const FIFTEEN_MINUTES = 15 * 60 * 1000;

export interface RateLimitOptions {
  windowMs: number;
  /** Limit applied to all `/api` routes. */
  apiLimit: number;
  /** Stricter limit applied to `/api/stock`. */
  stockLimit: number;
}

export interface CreateAppOptions {
  env: Env;
  /** Overrides the default rate-limit configuration (used by tests). */
  rateLimit?: RateLimitOptions;
}

/**
 * Resolves the CORS allow-list: configured origins plus the local dev origin
 * (added outside production). `*` is never used.
 */
function resolveAllowedOrigins(env: Env): string[] {
  const origins = new Set<string>(env.ALLOWED_ORIGINS);
  if (env.NODE_ENV !== "production") {
    origins.add(DEFAULT_DEV_ORIGIN);
  }
  return [...origins];
}

function resolveRateLimit(options: CreateAppOptions): RateLimitOptions {
  if (options.rateLimit) {
    return options.rateLimit;
  }
  // In test mode default to effectively unlimited so unrelated tests are not
  // throttled; dedicated rate-limit tests inject a low limit explicitly.
  if (options.env.NODE_ENV === "test") {
    return { windowMs: FIFTEEN_MINUTES, apiLimit: 1_000_000, stockLimit: 1_000_000 };
  }
  return { windowMs: FIFTEEN_MINUTES, apiLimit: 100, stockLimit: 20 };
}

/**
 * Builds the Express application. Kept separate from `listen` so tests can
 * exercise it via Supertest and inject configuration without binding a port.
 */
export function createApp(options: CreateAppOptions): Express {
  const { env } = options;
  const isDevelopment = env.NODE_ENV === "development";
  const allowedOrigins = resolveAllowedOrigins(env);
  const rateLimitConfig = resolveRateLimit(options);

  const app = express();
  app.disable("x-powered-by");

  // Trust the configured number of reverse-proxy hops so `req.ip` (used as the
  // rate-limit key) reflects the real client. 0 = trust none (direct socket
  // address); we never use the unconditional `true`, which would trust a
  // forgeable `X-Forwarded-For`.
  app.set("trust proxy", env.TRUST_PROXY);

  // --- Middleware order (security-critical) ---------------------------------
  // 1. helmet       — baseline security headers on every response.
  // 2. cors         — cross-origin allow-list (disallowed origins -> 403).
  // 3. /api/health  — mounted BEFORE the limiters and body parser so liveness
  //                   probes are never throttled and skip body parsing.
  // 4. apiLimiter   — baseline limiter for /api, placed BEFORE the body parser
  //                   so malformed / oversized bodies are rate-limited too.
  // 5. express.json — body parser (invalid JSON -> 400, oversized -> 413).
  // 6. /api/stock   — stricter limiter for stock routes (Phase 2 outbound).
  // 7. notFound     — unified 404 for unmatched routes.
  // 8. errorHandler — unified error contract; never leaks internals.
  // --------------------------------------------------------------------------

  // 1. Security headers. Defaults are kept (not loosened); cross-origin access
  // to this JSON API is governed explicitly by the CORS allow-list below.
  app.use(helmet());

  // 2. CORS.
  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, server-to-server, health
        // checks, same-origin) are allowed; CORS only guards browser origins.
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new ApiError(403, "FORBIDDEN_ORIGIN", "Origin is not allowed."));
      },
      // No cookies / session auth in this API, so credentials are disabled.
      credentials: false,
    })
  );

  // Baseline limiter for the whole API, plus a stricter one for stock routes
  // (where Phase 2 will trigger outbound Alpha Vantage calls).
  const apiLimiter = createLimiter({
    windowMs: rateLimitConfig.windowMs,
    limit: rateLimitConfig.apiLimit,
  });
  const stockLimiter = createLimiter({
    windowMs: rateLimitConfig.windowMs,
    limit: rateLimitConfig.stockLimit,
  });

  // 3. Health is intentionally mounted before any limiter or body parser:
  // monitoring / liveness probes must stay reliable, and the endpoint is a
  // trivial static JSON response (no I/O, no body parsing), so its abuse
  // surface is negligible.
  app.use("/api/health", healthRouter);

  // 4. Baseline API limiter — must run before the body parser so that invalid
  // JSON, oversized bodies and other parser failures are also throttled.
  app.use("/api", apiLimiter);

  // 5. Body parser (10kb cap). Errors are normalized by the error handler.
  app.use(express.json({ limit: "10kb" }));

  // 6. Stricter limiter for stock routes.
  app.use("/api/stock", stockLimiter, stockRouter);

  // 7 & 8. Unified 404 + error contract.
  app.use(notFoundHandler);
  app.use(createErrorHandler({ isDevelopment }));

  return app;
}
