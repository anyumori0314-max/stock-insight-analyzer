import type { RequestHandler } from "express";
import { ApiError } from "../types/errors";

/**
 * Terminal handler for unmatched routes. Forwards a unified 404 to the error
 * handler so clients always receive JSON (never Express' default HTML page).
 * Uses a generic message to avoid reflecting arbitrary request input.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, "NOT_FOUND", "The requested resource was not found."));
};
