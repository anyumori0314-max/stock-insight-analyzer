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
  | "NOT_IMPLEMENTED";

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
