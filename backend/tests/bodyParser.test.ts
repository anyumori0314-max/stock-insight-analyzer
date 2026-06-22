import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

// A payload comfortably above the 10kb body cap.
const OVERSIZED_BODY = JSON.stringify({ blob: "x".repeat(20_000) });

describe("JSON body parser errors", () => {
  it("returns a unified 400 INVALID_JSON for malformed JSON", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/stock/AAPL")
      .set("Content-Type", "application/json")
      .send('{ "ticker": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
    expect(res.body.error.message).toBe("The request body contains invalid JSON.");
    // The unified error body now also carries a safe correlation id.
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.error).not.toHaveProperty("details");
  });

  it("returns a unified 413 PAYLOAD_TOO_LARGE when the body exceeds the cap", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/stock/AAPL")
      .set("Content-Type", "application/json")
      .send(OVERSIZED_BODY);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.body.error.message).toBe("The request body is too large.");
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("does not expose body-parser internals (no stack / parser message)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/api/stock/AAPL")
      .set("Content-Type", "application/json")
      .send("{ definitely not json");

    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/Unexpected token/i); // parser's own wording
    expect(raw).not.toMatch(/\bat\s+.+:\d+:\d+/); // no stack frames
    expect(res.body.error).not.toHaveProperty("stack");
  });
});

describe("Body parser errors are still subject to the global rate limiter", () => {
  it("throttles malformed-JSON requests once the API limit is exceeded", async () => {
    // Low global limit, generous stock limit. We hit a non-stock /api path so
    // only the global limiter is involved. The limiter runs BEFORE the body
    // parser, so repeated malformed requests are eventually 429 (not 400).
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 2, stockLimit: 1_000 },
    });

    const send = () =>
      request(app)
        .post("/api/unknown")
        .set("Content-Type", "application/json")
        .send("{ broken");

    const first = await send();
    const second = await send();
    const third = await send();

    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe("INVALID_JSON");
    expect(second.status).toBe(400);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("throttles oversized-body requests once the API limit is exceeded", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 2, stockLimit: 1_000 },
    });

    const send = () =>
      request(app)
        .post("/api/unknown")
        .set("Content-Type", "application/json")
        .send(OVERSIZED_BODY);

    const first = await send();
    const second = await send();
    const third = await send();

    expect(first.status).toBe(413);
    expect(second.status).toBe(413);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("does not share limiter state across app instances", async () => {
    const app = buildTestApp({
      rateLimit: { windowMs: 60_000, apiLimit: 1, stockLimit: 1 },
    });
    const res = await request(app)
      .post("/api/unknown")
      .set("Content-Type", "application/json")
      .send("{ broken");

    // A fresh app starts with a clean store, so the first request is not 429.
    expect(res.status).toBe(400);
  });
});
