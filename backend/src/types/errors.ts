/**
 * Public-facing API error contract.
 *
 * Every error returned to a client uses the unified shape:
 *   { "error": { "code": <ErrorCode>, "message": <string>, "details"?: unknown } }
 *
 * `details` is only ever populated in development; it is stripped in
 * test/production so internal information is never leaked.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_TICKER"
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "FORBIDDEN_ORIGIN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_SERVER_ERROR"
  | "NOT_IMPLEMENTED"
  // --- Phase 2: market-data provider (Alpha Vantage) integration --------------
  // No API key is configured on the backend, so no outbound call is made.
  | "API_KEY_MISSING"
  // The provider rejected our key (auth failure). The key itself is never
  // echoed back to the client.
  | "API_KEY_INVALID"
  // The provider's own rate limit was hit (its per-minute / daily quota).
  | "PROVIDER_RATE_LIMITED"
  // The outbound request exceeded our timeout budget.
  | "PROVIDER_TIMEOUT"
  // The provider was unreachable / returned a transport-level failure.
  | "PROVIDER_UNAVAILABLE"
  // The provider responded but the payload was unusable (non-JSON, wrong shape,
  // or failed cross-field validation). Raw bodies are never exposed.
  | "PROVIDER_RESPONSE_INVALID"
  // The ticker was valid in shape but the provider has no data for it.
  | "SYMBOL_NOT_FOUND"
  // Data was returned but there were too few usable points to analyze.
  | "INSUFFICIENT_DATA";

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Application error carrying an HTTP status and a stable, public error code.
 * Thrown from routes/middleware and translated into a unified JSON body by
 * the central error handler.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    // Restore prototype chain (required when extending built-ins under CJS target).
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
