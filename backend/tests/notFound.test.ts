import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

describe("Not-found handling", () => {
  it("returns a unified 404 JSON body for unknown /api routes", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(typeof res.body.error.message).toBe("string");
  });

  it("returns a unified 404 JSON body for non-api routes", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/totally/unknown");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
