import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import type { Env } from "./config/env";
import { createErrorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import { createLimiter } from "./middleware/rateLimiter";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import { healthRouter } from "./routes/health";
import { createReadinessRouter } from "./routes/ready";
import { createStockRouter } from "./routes/stock";
import { createFileReportRepository, type StockReportRepository } from "./services/reportRepository";
import { createStockService, type StockService } from "./services/stockService";
import { ApiError } from "./types/errors";
import { silentLogger, type Logger } from "./utils/logger";

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
  /** Injects a pre-built stock service (tests use a fake client / no network). */
  stockService?: StockService;
  /** Structured logger. Defaults to a silent logger (quiet tests). */
  logger?: Logger;
  /**
   * Persistent report cache. Injected by tests (temp dir / fake). When omitted,
   * a file-based repository is created OUTSIDE of test mode; in tests the
   * persistent layer stays off unless explicitly provided, so the suite never
   * touches the disk.
   */
  reportRepository?: StockReportRepository;
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
  const isProduction = env.NODE_ENV === "production";
  const allowedOrigins = resolveAllowedOrigins(env);
  const rateLimitConfig = resolveRateLimit(options);
  const logger = options.logger ?? silentLogger;

  // Persistent (disk) report cache — the second cache layer. Off in test mode
  // (so the suite never writes files) unless a test injects its own.
  const reportRepository =
    options.reportRepository ??
    (env.NODE_ENV === "test"
      ? undefined
      : createFileReportRepository({
          dir: env.STOCK_CACHE_DIR,
          maxEntries: env.STOCK_CACHE_MAX_ENTRIES,
          logger,
        }));

  // Build the stock service from the configured API key unless a test injects
  // one. A missing key does not block startup — requests then surface an
  // `API_KEY_MISSING` error instead.
  const stockService =
    options.stockService ??
    createStockService({
      apiKey: env.ALPHA_VANTAGE_API_KEY,
      dataMode: env.STOCK_DATA_MODE,
      timeoutMs: env.ALPHA_VANTAGE_TIMEOUT_MS,
      maxPoints: env.ALPHA_VANTAGE_MAX_POINTS,
      cacheTtlMs: env.STOCK_CACHE_TTL_SECONDS * 1000,
      cacheMaxEntries: env.STOCK_CACHE_MAX_ENTRIES,
      reportRepository,
    });

  const app = express();
  app.disable("x-powered-by");

  // Trust the configured number of reverse-proxy hops so `req.ip` (used as the
  // rate-limit key) reflects the real client. 0 = trust none (direct socket
  // address); we never use the unconditional `true`, which would trust a
  // forgeable `X-Forwarded-For`.
  app.set("trust proxy", env.TRUST_PROXY);

  // 0. Correlation id + structured access log run FIRST so every response —
  // including health probes, rate-limited 429s, 404s and errors — carries an
  // `X-Request-Id` and produces exactly one safe log record.
  app.use(requestId());
  app.use(requestLogger(logger));

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

  // 1. Security headers. This server returns ONLY JSON (the SPA is built and
  // served separately — see docs/DEPLOYMENT.md), so the strictest CSP applies:
  // nothing may be loaded, embedded or framed. These are defense-in-depth
  // (browsers do not apply CSP to JSON documents) but cost nothing and harden
  // any future HTML surface. Cross-origin access is governed by the CORS
  // allow-list below; CORP is set to cross-origin so the configured SPA origin
  // can read the API while CORS still restricts WHICH origins may do so.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: "no-referrer" },
      // HSTS only in production (served over HTTPS). In dev/test over plain HTTP
      // it would be ignored anyway; keeping it off matches deployment reality.
      hsts: isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // helmet does not emit Permissions-Policy; explicitly deny powerful browser
  // features this API never uses, on every response.
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
    );
    next();
  });

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

  // 3. Health (liveness) and readiness are mounted before any limiter or body
  // parser: monitoring probes must stay reliable, and both are trivial static
  // JSON responses (no I/O, no body parsing, no provider calls), so their abuse
  // surface is negligible. Liveness = "process up"; readiness = "ready to serve"
  // (reports the active data mode, never touches Alpha Vantage).
  app.use("/api/health", healthRouter);
  app.use(
    "/api/ready",
    createReadinessRouter({
      dataMode: env.STOCK_DATA_MODE,
      // Boolean only — the key VALUE is never passed to (or returned by) the probe.
      apiKeyConfigured: Boolean(env.ALPHA_VANTAGE_API_KEY),
    })
  );

  // 4. Baseline API limiter — must run before the body parser so that invalid
  // JSON, oversized bodies and other parser failures are also throttled.
  app.use("/api", apiLimiter);

  // 5. Body parser (10kb cap). Errors are normalized by the error handler.
  app.use(express.json({ limit: "10kb" }));

  // 6. Stricter limiter for stock routes.
  app.use("/api/stock", stockLimiter, createStockRouter(stockService));

  // 7 & 8. Unified 404 + error contract. The error handler logs unexpected
  // errors through the structured logger (never the raw Error / stack).
  app.use(notFoundHandler);
  app.use(createErrorHandler({ isDevelopment, logger }));

  return app;
}
