import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../src/middleware/errorHandler";

// An OS-independent, fictional "internal" detail. It deliberately contains no
// real username or machine-specific absolute path so the public repo stays
// clean across Windows / macOS / Linux, while still letting us assert that
// such internal detail never reaches the HTTP response.
const SECRET_MESSAGE = "secret detail at /internal/project/secret.ts:42:7";

/**
 * Builds a tiny app that throws the given error from its single route, wired to
 * the real production error handler. This exercises the error-handling paths
 * without adding any test-only route to the application code.
 */
function buildThrowingApp(err: unknown, isDevelopment = false) {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.use(createErrorHandler({ isDevelopment }));
  return app;
}

describe("Error handler — generic 500 for unexpected errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts a non-ApiError into 500 INTERNAL_SERVER_ERROR (production)", async () => {
    const app = buildThrowingApp(new Error(SECRET_MESSAGE), false);
    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });

  it("never leaks stack, internal paths or the original message (production)", async () => {
    const app = buildThrowingApp(new Error(SECRET_MESSAGE), false);
    const res = await request(app).get("/boom");

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("/internal/project");
    expect(raw).not.toMatch(/\bat\s+.+:\d+:\d+/); // no stack frames
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body.error).not.toHaveProperty("stack");
    expect(res.body.error).not.toHaveProperty("details");
  });

  it("does not leak secrets in the response even in development", async () => {
    // Dev logs to the console (suppressed here); the *response* must still be
    // the generic body with no internal details.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = buildThrowingApp(new Error(SECRET_MESSAGE), true);
    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("Error handler — body-parser look-alikes are not misclassified", () => {
  it("treats a plain Error carrying only type=entity.parse.failed as 500 (not 400)", async () => {
    // No `expose`, no numeric `status`, no `body` — so it is NOT a real
    // body-parser error and must become a generic 500.
    const forged = Object.assign(new Error("fake parse failure"), {
      type: "entity.parse.failed",
    });
    const res = await request(buildThrowingApp(forged)).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("treats a plain Error carrying only type=entity.too.large as 500 (not 413)", async () => {
    const forged = Object.assign(new Error("fake size failure"), {
      type: "entity.too.large",
    });
    const res = await request(buildThrowingApp(forged)).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
