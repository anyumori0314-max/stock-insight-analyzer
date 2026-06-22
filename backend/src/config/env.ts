import { z } from "zod";

/**
 * Treats empty / whitespace-only strings as "not provided" so that an
 * `ALPHA_VANTAGE_API_KEY=` line in `.env` does not fail validation during
 * Phase 1 (the key only becomes required once real Alpha Vantage calls land).
 */
const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  // Number of reverse-proxy hops to trust for client IP resolution.
  // 0 (default) = trust none: `req.ip` is the direct socket address and any
  // `X-Forwarded-For` header is ignored. A positive value trusts that many
  // hops. We never use Express' unconditional `true`, which would blindly
  // trust a forgeable `X-Forwarded-For`. Invalid values fail startup below.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Optional at startup so the app boots without a key; a request without it
  // surfaces an `API_KEY_MISSING` error instead of crashing. The key is only
  // ever read on the backend and never sent to the client.
  ALPHA_VANTAGE_API_KEY: optionalSecret,
  // Per-request timeout (ms) for outbound Alpha Vantage calls.
  ALPHA_VANTAGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(8000),
  // Hard cap on accepted daily points from the provider. `outputsize=compact`
  // returns ~100; 120 leaves headroom while rejecting an unexpectedly huge
  // response (PROVIDER_RESPONSE_INVALID) instead of silently truncating it.
  // Must be a positive integer; capped to a sane ceiling.
  ALPHA_VANTAGE_MAX_POINTS: z.coerce.number().int().positive().max(10000).default(120),
  // Maximum number of (ticker:range) reports kept in the in-memory cache.
  // Bounds memory and enables LRU eviction. Must be a positive integer.
  STOCK_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().max(100000).default(100),
  // Cache lifetime (SECONDS) for a stock report. Daily bars only change after
  // the close, so a multi-hour TTL shields the provider's scarce free-tier
  // quota while staying same-day fresh. Default 21600 = 6h; capped at 86400
  // (24h). Zero / negative / non-integer values are rejected at startup.
  STOCK_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(86_400)
    .default(21_600),
  // Directory for the PERSISTENT (disk) report cache — the second cache layer
  // that survives restarts. Stores only validated public `StockReport`s
  // (never the API key or raw provider bodies), keyed by `ticker:range` with a
  // TTL + schema version. Relative paths resolve from the process CWD; point it
  // at a writable, persistent volume in production. The directory itself is
  // git-ignored. A write failure degrades to memory-only (never a request error).
  STOCK_CACHE_DIR: z.string().min(1).default(".cache/stock-reports"),
  // Data source for stock reports:
  //   live = call Alpha Vantage (consumes the free-tier quota).
  //   mock = serve deterministic in-process fixtures (no external traffic).
  // Default is `live` on purpose: an unset value must never silently serve fake
  // data (e.g. in production). Developers opt into `mock` explicitly in `.env`.
  // The production guard below additionally rejects `mock` when NODE_ENV=production.
  STOCK_DATA_MODE: z.enum(["live", "mock"]).default("live"),
  // Comma-separated list of additional allowed CORS origins.
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean)
        : []
    ),
  })
  // Cross-field guards for production. These are startup errors, surfaced like
  // any other invalid env value (variable name + message only, never the value).
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") {
      return;
    }
    // Never run the mock provider in production: a stray `STOCK_DATA_MODE=mock`
    // must not ship fake prices to real users.
    if (env.STOCK_DATA_MODE === "mock") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STOCK_DATA_MODE"],
        message: "mock data mode is not allowed when NODE_ENV=production.",
      });
    }
    // The SPA is served from a different origin in production, so an explicit
    // CORS allow-list is mandatory — the dev fallback origin is not added in
    // production, and `*` is never used. An empty list would reject the real SPA.
    if (env.ALLOWED_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOWED_ORIGINS"],
        message: "ALLOWED_ORIGINS must list at least one origin when NODE_ENV=production.",
      });
    }
    // NOTE: a missing ALPHA_VANTAGE_API_KEY in live mode is intentionally NOT a
    // startup failure — the app still boots and `/api/ready` reports not_ready
    // (and stock requests return 503 API_KEY_MISSING) so the key can be supplied
    // without a crash loop. See routes/ready.ts.
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns a typed view of environment variables.
 *
 * On failure it throws with variable names + messages only. Received values
 * are never included, so secrets such as the API key cannot leak into logs.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}
