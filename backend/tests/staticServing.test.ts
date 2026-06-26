import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../src/app";
import { loadEnv } from "../src/config/env";
import type { StockService } from "../src/services/stockService";

/**
 * Single-container (Phase 21) serving: ONE process serves the SPA AND `/api`.
 * Verifies the static + history-fallback behaviour without Docker — the image
 * just points `STOCK_STATIC_DIR` at the bundled frontend build.
 */

const INDEX_HTML =
  '<!doctype html><html><head><title>Stock Insight</title></head>' +
  '<body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const ASSET_JS = 'export const x = 1;';

let staticDir: string;
const unusedService: StockService = {
  getReport: async () => {
    throw new Error("the stock service is unused in static-serving tests");
  },
};

function appWithStatic() {
  const env = loadEnv({ NODE_ENV: "test" });
  return createApp({ env, staticDir, stockService: unusedService });
}

function appJsonOnly() {
  const env = loadEnv({ NODE_ENV: "test" });
  return createApp({ env, stockService: unusedService });
}

beforeEach(() => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-test-"));
  fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(staticDir, "index.html"), INDEX_HTML, "utf8");
  fs.writeFileSync(path.join(staticDir, "assets", "app.js"), ASSET_JS, "utf8");
});

afterEach(() => {
  fs.rmSync(staticDir, { recursive: true, force: true });
});

describe("SPA static serving (single-container mode)", () => {
  it("serves index.html at the root", async () => {
    const res = await request(appWithStatic()).get("/");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('<div id="root">');
  });

  it("serves a real static asset directly", async () => {
    const res = await request(appWithStatic()).get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toBe(ASSET_JS);
  });

  it("falls back to index.html for an unknown client route", async () => {
    const res = await request(appWithStatic()).get("/watchlist/AAPL");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });

  it("returns a JSON 404 for an unknown /api route (NOT the SPA shell)", async () => {
    const res = await request(appWithStatic()).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.type).toMatch(/json/);
    expect(res.body.error?.code ?? res.body.code).toBe("NOT_FOUND");
    expect(res.text).not.toContain('<div id="root">');
  });

  it("does not let the SPA fallback shadow /api/health or /api/ready", async () => {
    const health = await request(appWithStatic()).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.type).toMatch(/json/);

    const ready = await request(appWithStatic()).get("/api/ready");
    expect(ready.type).toMatch(/json/);
    expect([200, 503]).toContain(ready.status);
  });

  it("does not serve the SPA for non-GET methods (POST unknown -> JSON 404)", async () => {
    const res = await request(appWithStatic()).post("/some/page");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<div id="root">');
  });

  it("uses an SPA-safe CSP when serving static (self, not 'none')", async () => {
    const res = await request(appWithStatic()).get("/");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
  });

  it("allows a SAME-ORIGIN request (the bundled SPA calls /api on this origin)", async () => {
    const res = await request(appWithStatic())
      .get("/api/health")
      .set("Host", "myapp.example")
      .set("Origin", "http://myapp.example");
    expect(res.status).toBe(200);
  });

  it("still rejects a genuinely cross-origin request even while serving the SPA", async () => {
    const res = await request(appWithStatic())
      .get("/api/health")
      .set("Host", "myapp.example")
      .set("Origin", "http://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.error?.code ?? res.body.code).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("JSON-only mode (SPA hosted separately)", () => {
  it("does NOT serve a SPA: root is a JSON 404", async () => {
    const res = await request(appJsonOnly()).get("/");
    expect(res.status).toBe(404);
    expect(res.type).toMatch(/json/);
  });

  it("keeps the strict default-src 'none' CSP", async () => {
    const res = await request(appJsonOnly()).get("/api/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe("Dockerfile single-image consistency", () => {
  const dockerfile = fs.readFileSync(path.resolve(__dirname, "..", "..", "Dockerfile"), "utf8");

  it("defaults to PORT 3000 and EXPOSE 3000", () => {
    expect(dockerfile).toMatch(/PORT=3000/);
    expect(dockerfile).toMatch(/EXPOSE 3000/);
  });

  it("points STOCK_STATIC_DIR at the bundled frontend build", () => {
    expect(dockerfile).toMatch(/STOCK_STATIC_DIR=/);
  });

  it("health-checks /api/health on the configured PORT", () => {
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/\/api\/health/);
    expect(dockerfile).toMatch(/process\.env\.PORT/);
  });

  it("builds the frontend and copies it into the runtime image (multi-stage)", () => {
    expect(dockerfile).toMatch(/AS frontend/);
    expect(dockerfile).toMatch(/COPY --from=frontend/);
  });
});
