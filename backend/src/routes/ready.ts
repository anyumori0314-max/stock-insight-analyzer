import { Router } from "express";

import type { StockDataMode } from "../types/stock";

export interface ReadinessOptions {
  /** Active data source, reported so probes can confirm mock vs live. */
  dataMode: StockDataMode;
  /**
   * Whether an Alpha Vantage API key is configured. A BOOLEAN only — the key
   * value is never passed in, so it can never appear in a probe response or log.
   */
  apiKeyConfigured: boolean;
  /** Process start time (epoch ms). Defaults to "now" at router creation. */
  startedAt?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

/**
 * Readiness probe (Phase 10) — separate from liveness (`/api/health`).
 *
 * Liveness answers "is the process up?"; readiness answers "can this instance
 * actually SERVE requests?". Readiness reflects IN-PROCESS configuration only
 * (the active data mode, whether the dependencies a real request needs are
 * present) and NEVER calls Alpha Vantage, so orchestrators can poll it frequently
 * without consuming the provider's free-tier quota.
 *
 * It returns 503 (`status:"not_ready"`) on a configuration gap that would make
 * stock requests fail — specifically `live` mode with NO API key, where every
 * `/api/stock` call would 503 `API_KEY_MISSING`. The response lists only safe tag
 * strings (e.g. `alpha_vantage_api_key_missing`); no secret VALUE is included.
 * (Missing `ALLOWED_ORIGINS` in production is caught earlier — it fails startup in
 * `loadEnv`, so the instance never comes up to report ready.)
 */
export function createReadinessRouter(options: ReadinessOptions): Router {
  const router = Router();
  const startedAt = options.startedAt ?? Date.now();
  const now = options.now ?? Date.now;

  router.get("/", (_req, res) => {
    const issues: string[] = [];
    // Live mode with no key cannot serve stock data — not ready.
    if (options.dataMode === "live" && !options.apiKeyConfigured) {
      issues.push("alpha_vantage_api_key_missing");
    }

    const ready = issues.length === 0;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dataMode: options.dataMode,
      uptimeSeconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
      // Only present when not ready, and only safe tags (never secret values).
      ...(ready ? {} : { issues }),
    });
  });

  return router;
}
