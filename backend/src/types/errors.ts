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
 * Single source of truth for every public error code.
 *
 * Each descriptor pins the HTTP status, the stable public message (already
 * safe to expose — it never contains provider raw bodies, URLs, keys, stacks or
 * paths) and whether the client may meaningfully retry. The provider client and
 * service build errors from this catalog (`errorFor`) so status / message /
 * retry semantics cannot drift between call sites.
 */
export interface ErrorDescriptor {
  status: number;
  message: string;
  /** True when the same request may succeed if retried later (transient). */
  retryable: boolean;
}

export const ERROR_CATALOG: Record<ErrorCode, ErrorDescriptor> = {
  VALIDATION_ERROR: { status: 400, message: "The request was invalid.", retryable: false },
  INVALID_TICKER: { status: 400, message: "The ticker format is invalid.", retryable: false },
  INVALID_JSON: { status: 400, message: "The request body contains invalid JSON.", retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request body is too large.", retryable: false },
  FORBIDDEN_ORIGIN: { status: 403, message: "Origin is not allowed.", retryable: false },
  NOT_FOUND: { status: 404, message: "The requested resource was not found.", retryable: false },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please slow down.", retryable: true },
  INTERNAL_SERVER_ERROR: { status: 500, message: "An unexpected error occurred.", retryable: false },
  NOT_IMPLEMENTED: { status: 501, message: "This feature is not implemented.", retryable: false },
  // --- Provider (Alpha Vantage) integration ---------------------------------
  API_KEY_MISSING: {
    status: 503,
    message: "Stock data is temporarily unavailable. The market data API key is not configured.",
    retryable: false,
  },
  API_KEY_INVALID: {
    status: 401,
    message: "The market data provider rejected the API key.",
    retryable: false,
  },
  PROVIDER_RATE_LIMITED: {
    status: 429,
    message: "The market data provider's rate limit was reached. Please try again later.",
    retryable: true,
  },
  PROVIDER_TIMEOUT: {
    status: 504,
    message: "The market data provider did not respond in time. Please try again.",
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    status: 502,
    message: "The market data provider is currently unavailable. Please try again later.",
    retryable: true,
  },
  PROVIDER_RESPONSE_INVALID: {
    status: 502,
    message: "The market data provider returned an unexpected response.",
    retryable: false,
  },
  SYMBOL_NOT_FOUND: {
    status: 404,
    message: "No data is available for the requested ticker.",
    retryable: false,
  },
  INSUFFICIENT_DATA: {
    status: 422,
    message: "Not enough data is available to analyze this ticker.",
    retryable: false,
  },
};

/**
 * Builds an {@link ApiError} from the catalog. `details` is for development-only
 * diagnostics (the error handler strips it outside development); pass only
 * safe, internal tags here — never provider raw bodies, URLs or the API key.
 */
export function errorFor(code: ErrorCode, details?: unknown): ApiError {
  const descriptor = ERROR_CATALOG[code];
  return new ApiError(descriptor.status, code, descriptor.message, details);
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
