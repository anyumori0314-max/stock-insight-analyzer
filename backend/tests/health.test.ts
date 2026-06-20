import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";

describe("GET /api/health", () => {
  it("returns 200 with JSON status ok", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: "ok" });
  });
});
