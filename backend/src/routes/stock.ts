import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { tickerSchema } from "../schemas/stock";
import { ApiError } from "../types/errors";

export const stockRouter = Router();

/**
 * GET /api/stock/:ticker
 *
 * Phase 1: validates and normalizes the ticker, then responds with 501.
 * Alpha Vantage integration arrives in Phase 2 — no external call is made here.
 */
stockRouter.get(
  "/:ticker",
  asyncHandler(async (req, res) => {
    void res; // response is produced by the error handler in Phase 1
    const result = tickerSchema.safeParse(req.params.ticker);

    if (!result.success) {
      throw new ApiError(
        400,
        "INVALID_TICKER",
        "The ticker format is invalid.",
        result.error.issues.map((issue) => issue.message)
      );
    }

    const ticker = result.data;

    throw new ApiError(
      501,
      "NOT_IMPLEMENTED",
      "Stock data integration is not available yet.",
      { ticker }
    );
  })
);
