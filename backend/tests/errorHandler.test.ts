import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../src/middleware/errorHandler";
import { createLogger, type Logger } from "../src/utils/logger";

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
function buildThrowingApp(err: unknown, isDevelopment = false, logger?: Logger) {
  const app = express();
  app.get("/boom", () => {
    throw err;
  });
  app.use(createErrorHandler({ isDevelopment, logger }));
  return app;
}

/** A logger that records every emitted record for assertions. */
function capturingLogger() {
  const records: Array<Record<string, unknown>> = [];
  const logger = createLogger({ level: "debug", sink: (_l, line) => records.push(JSON.parse(line)) });
  return { logger, records };
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
    // The *response* must be the generic body with no internal details, in dev too.
    const { logger } = capturingLogger();
    const app = buildThrowingApp(new Error(SECRET_MESSAGE), true, logger);
    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("NEVER passes the raw Error to console.error (uses the structured logger)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger, records } = capturingLogger();
    const app = buildThrowingApp(new Error(SECRET_MESSAGE), true, logger);

    await request(app).get("/boom");

    // The raw Error (with its message/stack) is never handed to console.error.
    expect(consoleSpy).not.toHaveBeenCalled();
    // Exactly one safe structured error event is emitted instead.
    const errorLogs = records.filter((r) => r.event === "error.unhandled");
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({ level: "error", status: 500, errorCode: "INTERNAL_SERVER_ERROR" });
  });

  it("logs no stack frame, local absolute path, secret, or api-key-looking value", async () => {
    const { logger, records } = capturingLogger();
    // An error whose message embeds a stack-like frame, a Windows path and a key.
    const nasty = new Error("boom at C:\\\\Users\\\\dev\\\\secret.ts:42:7 apikey=ABCD1234SECRET");
    nasty.stack = "Error: boom\n    at fn (C:\\\\Users\\\\dev\\\\app.ts:10:5)";
    const app = buildThrowingApp(nasty, false, logger);

    await request(app).get("/boom");

    const dump = JSON.stringify(records);
    expect(dump).not.toMatch(/\bat\s+.+:\d+:\d+/); // no stack frames
    expect(dump).not.toMatch(/[A-Za-z]:\\\\/); // no Windows absolute path
    expect(dump).not.toContain("secret.ts");
    expect(dump).not.toContain("ABCD1234SECRET");
    expect(dump).not.toContain("apikey");
  });

  it("records the requestId on the structured error event when present", async () => {
    const { logger, records } = capturingLogger();
    const app = express();
    app.use((req, _res, next) => {
      req.requestId = "req-123";
      next();
    });
    app.get("/boom", () => {
      throw new Error(SECRET_MESSAGE);
    });
    app.use(createErrorHandler({ isDevelopment: false, logger }));

    await request(app).get("/boom");

    const errorLog = records.find((r) => r.event === "error.unhandled");
    expect(errorLog?.requestId).toBe("req-123");
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
