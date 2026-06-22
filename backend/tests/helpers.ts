import { createApp, type RateLimitOptions } from "../src/app";
import { loadEnv } from "../src/config/env";
import type { StockService } from "../src/services/stockService";
import type { Logger } from "../src/utils/logger";

interface BuildTestAppOptions {
  /** Extra environment overrides merged on top of NODE_ENV=test. */
  env?: NodeJS.ProcessEnv;
  /** Inject a specific rate-limit configuration (e.g. to trigger 429). */
  rateLimit?: RateLimitOptions;
  /** Inject a fake stock service so route tests need no network / API key. */
  stockService?: StockService;
  /** Inject a logger to assert on emitted records (defaults to silent). */
  logger?: Logger;
}

/**
 * Creates an isolated app instance for a single test. No port is bound and no
 * real `.env` is read — environment is constructed explicitly here.
 */
export function buildTestApp(options: BuildTestAppOptions = {}) {
  const env = loadEnv({ NODE_ENV: "test", ...options.env });
  return createApp({
    env,
    rateLimit: options.rateLimit,
    stockService: options.stockService,
    logger: options.logger,
  });
}
