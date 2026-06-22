import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

const DEV_ORIGIN = "http://localhost:5173";

describe("CORS — simple requests", () => {
  it("allows the default dev origin outside production", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health").set("Origin", DEV_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(DEV_ORIGIN);
  });

  it("allows requests without an Origin header", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
  });

  it("rejects a disallowed origin with a unified 403 and no ACAO header", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health").set("Origin", "http://evil.example");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not set access-control-allow-credentials (no cookie auth)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health").set("Origin", DEV_ORIGIN);

    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("CORS — preflight (OPTIONS)", () => {
  it("answers a preflight from an allowed origin with ACAO", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .options("/api/stock/AAPL")
      .set("Origin", DEV_ORIGIN)
      .set("Access-Control-Request-Method", "GET");

    expect([200, 204]).toContain(res.status);
    expect(res.headers["access-control-allow-origin"]).toBe(DEV_ORIGIN);
  });

  it("rejects a preflight from a disallowed origin with a unified 403", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .options("/api/stock/AAPL")
      .set("Origin", "http://evil.example")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("CORS — ALLOWED_ORIGINS parsing", () => {
  it("supports multiple origins, trims whitespace, ignores empty + duplicate entries", async () => {
    const app = buildTestApp({
      env: { ALLOWED_ORIGINS: " https://a.example , , https://b.example ,https://a.example " },
    });

    const a = await request(app).get("/api/health").set("Origin", "https://a.example");
    const b = await request(app).get("/api/health").set("Origin", "https://b.example");
    const c = await request(app).get("/api/health").set("Origin", "https://c.example");

    expect(a.status).toBe(200);
    expect(a.headers["access-control-allow-origin"]).toBe("https://a.example");
    expect(b.status).toBe(200);
    expect(b.headers["access-control-allow-origin"]).toBe("https://b.example");
    expect(c.status).toBe(403);
  });
});

describe("CORS — production hardening", () => {
  it("does not allow localhost by default in production", async () => {
    // Production requires an explicit allow-list; configure a real origin, then
    // confirm the dev origin is still NOT auto-allowed.
    const app = buildTestApp({
      env: { NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example" },
    });
    const res = await request(app).get("/api/health").set("Origin", DEV_ORIGIN);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows an explicitly configured production origin", async () => {
    const app = buildTestApp({
      env: { NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example" },
    });
    const res = await request(app).get("/api/health").set("Origin", "https://app.example");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example");
  });
});
