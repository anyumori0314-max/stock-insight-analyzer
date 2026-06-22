import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "./helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Request ID (X-Request-Id)", () => {
  it("returns a server-generated UUID when none is supplied", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health");
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("adopts a safe client-provided id", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health").set("X-Request-Id", "trace-123_ABC");
    expect(res.headers["x-request-id"]).toBe("trace-123_ABC");
  });

  it("ignores an unsafe client id and generates a fresh UUID", async () => {
    const app = buildTestApp();
    const unsafe = "not a valid id!"; // spaces + '!' fail the allow-list
    const res = await request(app).get("/api/health").set("X-Request-Id", unsafe);
    expect(res.headers["x-request-id"]).not.toBe(unsafe);
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("ignores an over-long client id", async () => {
    const app = buildTestApp();
    const tooLong = "a".repeat(200);
    const res = await request(app).get("/api/health").set("X-Request-Id", tooLong);
    expect(res.headers["x-request-id"]).not.toBe(tooLong);
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("echoes the request id in error responses (matches the header)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/INVALID!!!");
    expect(res.status).toBe(400);
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });
});
