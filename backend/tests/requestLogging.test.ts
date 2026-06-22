import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildTestApp } from "./helpers";
import { createLogger } from "../src/utils/logger";
import type { StockReport } from "../src/types/report";
import type { StockService } from "../src/services/stockService";

function capturingLogger() {
  const records: Array<Record<string, unknown>> = [];
  const logger = createLogger({ level: "debug", sink: (_l, line) => records.push(JSON.parse(line)) });
  return { logger, records };
}

const httpLogs = (records: Array<Record<string, unknown>>) =>
  records.filter((r) => r.event === "http.request");

describe("Structured access logging", () => {
  it("logs exactly one safe record per request (method/path/status/duration/requestId)", async () => {
    const { logger, records } = capturingLogger();
    const app = buildTestApp({ logger });
    const res = await request(app).get("/api/health");

    const logs = httpLogs(records);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: "GET", path: "/api/health", status: 200 });
    expect(typeof logs[0].durationMs).toBe("number");
    expect(logs[0].requestId).toBe(res.headers["x-request-id"]);
  });

  it("records the public error code for a 404 (and never a stack)", async () => {
    const { logger, records } = capturingLogger();
    const app = buildTestApp({ logger });
    await request(app).get("/api/does-not-exist");

    const log = httpLogs(records).at(-1)!;
    expect(log.status).toBe(404);
    expect(log.errorCode).toBe("NOT_FOUND");
    expect(JSON.stringify(records)).not.toMatch(/\bat\s+.+:\d+:\d+/); // no stack frames
  });

  it("logs a 500 at error level and never leaks the internal message", async () => {
    const { logger, records } = capturingLogger();
    const boom: StockService = {
      getReport: async () => {
        throw new Error("internal db password=hunter2");
      },
    };
    const app = buildTestApp({ logger, stockService: boom });
    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(500);
    const log = httpLogs(records).at(-1)!;
    expect(log.level).toBe("error");
    expect(log.status).toBe(500);
    expect(log.errorCode).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(records)).not.toContain("hunter2");
  });

  it("logs the normalized ticker, source and cache state for a stock request", async () => {
    const { logger, records } = capturingLogger();
    const report = {
      ticker: "AAPL",
      source: "mock",
      cache: { hit: false, expiresAt: null },
    } as unknown as StockReport;
    const app = buildTestApp({ logger, stockService: { getReport: async () => report } });

    await request(app).get("/api/stock/aapl");
    const log = httpLogs(records).at(-1)!;
    expect(log).toMatchObject({ status: 200, ticker: "AAPL", source: "mock", cacheHit: false });
  });
});
