import { Router } from "express";

export const healthRouter = Router();

/**
 * GET /api/health
 * Lightweight liveness probe. Always returns 200 with a small JSON payload.
 */
healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});
