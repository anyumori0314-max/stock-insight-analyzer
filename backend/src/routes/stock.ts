import { Router } from "express";

import { rangeQuerySchema, tickerSchema } from "../schemas/stock";
import type { StockService } from "../services/stockService";
import { ApiError } from "../types/errors";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Builds the `/api/stock` router around an injected {@link StockService}.
 *
 * GET /api/stock/:ticker
 *   1. Validates and normalizes the ticker (ASCII allow-list, uppercased).
 *   2. Delegates to the service, which serves from cache or fetches + analyzes
 *      the Alpha Vantage daily series.
 * All failure modes are normalized to the unified `ApiError` contract upstream.
 */
export function createStockRouter(service: StockService): Router {
  const router = Router();

  router.get(
    "/:ticker",
    asyncHandler(async (req, res) => {
      const result = tickerSchema.safeParse(req.params.ticker);

      if (!result.success) {
        throw new ApiError(
          400,
          "INVALID_TICKER",
          "The ticker format is invalid.",
          result.error.issues.map((issue) => issue.message)
        );
      }

      // Optional ?range= (defaults to the standard window). An unsupported range
      // is rejected rather than silently coerced.
      const rangeResult = rangeQuerySchema.safeParse(req.query.range);
      if (!rangeResult.success) {
        throw new ApiError(
          400,
          "INVALID_RANGE",
          "The requested range is not supported.",
          rangeResult.error.issues.map((issue) => issue.message)
        );
      }

      const report = await service.getReport(result.data, rangeResult.data);
      // Expose safe, already-normalized fields for the structured access logger
      // (never raw input, never secrets).
      res.locals.ticker = report.ticker;
      res.locals.cacheHit = report.cache.hit;
      res.locals.source = report.source;
      res.json(report);
    })
  );

  return router;
}
