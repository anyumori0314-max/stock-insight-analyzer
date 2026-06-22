import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { buildTestApp } from "./helpers";

describe("GET /api/ready (readiness)", () => {
  it("returns 200 with status ready and the active data mode", async () => {
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "mock" } });
    const res = await request(app).get("/api/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.dataMode).toBe("mock");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("reports live mode when configured live", async () => {
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "live" } });
    const res = await request(app).get("/api/ready");
    expect(res.body.dataMode).toBe("live");
  });

  it("never performs outbound provider traffic (no fetch) for ready or health", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = buildTestApp();

    await request(app).get("/api/ready");
    await request(app).get("/api/health");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("carries a request id like every other response", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/ready");
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

describe("GET /api/ready — configuration readiness (Phase 6 hardening)", () => {
  it("is NOT ready in live mode with no API key (503 + safe issue tag)", async () => {
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "live", ALPHA_VANTAGE_API_KEY: "" } });
    const res = await request(app).get("/api/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.issues).toContain("alpha_vantage_api_key_missing");
  });

  it("is ready in live mode once an API key is configured", async () => {
    const app = buildTestApp({
      env: { STOCK_DATA_MODE: "live", ALPHA_VANTAGE_API_KEY: "DEMO-KEY-1234" },
    });
    const res = await request(app).get("/api/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body).not.toHaveProperty("issues");
  });

  it("is ready in mock mode without any API key", async () => {
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "mock" } });
    const res = await request(app).get("/api/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });

  it("never echoes the API key value in the readiness body (only a boolean-derived tag)", async () => {
    const secret = "SUPER-SECRET-KEY-9999";
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "live", ALPHA_VANTAGE_API_KEY: secret } });
    const res = await request(app).get("/api/ready");
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it("does not call the provider to decide readiness, even when not ready", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "live", ALPHA_VANTAGE_API_KEY: "" } });

    const res = await request(app).get("/api/ready");

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps /api/health a lightweight 200 liveness even when readiness is not ready", async () => {
    const app = buildTestApp({ env: { STOCK_DATA_MODE: "live", ALPHA_VANTAGE_API_KEY: "" } });

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);

    const ready = await request(app).get("/api/ready");
    expect(ready.status).toBe(503);
  });
});
