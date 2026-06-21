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

const envSchema = z.object({
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
  // Maximum number of (ticker:range) reports kept in the in-memory cache.
  // Bounds memory and enables LRU eviction. Must be a positive integer.
  STOCK_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().max(100000).default(100),
  // Cache lifetime (ms) for a stock report. Daily bars only change after the
  // close, so a few minutes shields the provider's scarce free-tier quota.
  STOCK_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(86_400_000)
    .default(5 * 60 * 1000),
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
