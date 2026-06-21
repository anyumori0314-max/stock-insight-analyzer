import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

describe("Security headers (helmet)", () => {
  it("sets key security headers and hides x-powered-by", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("Error responses", () => {
  it("never includes a stack trace or internal fields", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/INVALID!!!");

    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/\bat\s+.+:\d+:\d+/); // no stack frames
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body.error).not.toHaveProperty("stack");
  });

  it("keeps the API-key-missing contract clean (no details leaked outside development)", async () => {
    // With no API key configured (the default test env), a valid ticker yields
    // a unified 503 API_KEY_MISSING body with no `details` outside development.
    // The genuine 500 path for unexpected (non-ApiError) errors is covered in
    // errorHandler.test.ts.
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("API_KEY_MISSING");
    expect(res.body.error).not.toHaveProperty("details"); // stripped outside dev
  });
});
