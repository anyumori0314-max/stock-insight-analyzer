import { Router } from "express";

import { tickerSchema } from "../schemas/stock";
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

      const report = await service.getReport(result.data);
      res.json(report);
    })
  );

  return router;
}
