import { describe, expect, it } from "vitest";

import { createLogger } from "../src/utils/logger";

function capture(level: "debug" | "info" | "warn" | "error" = "debug") {
  const lines: Array<{ level: string; record: Record<string, unknown> }> = [];
  const logger = createLogger({
    level,
    now: () => new Date("2026-06-21T00:00:00.000Z"),
    sink: (lvl, line) => lines.push({ level: lvl, record: JSON.parse(line) }),
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("emits one structured JSON record with timestamp/level/event and safe fields", () => {
    const { logger, lines } = capture();
    logger.info("http.request", { requestId: "abc", status: 200, durationMs: 1.2 });

    expect(lines).toHaveLength(1);
    expect(lines[0].record).toMatchObject({
      timestamp: "2026-06-21T00:00:00.000Z",
      level: "info",
      event: "http.request",
      requestId: "abc",
      status: 200,
      durationMs: 1.2,
    });
  });

  it("redacts secret-looking keys but keeps ordinary ones", () => {
    const { logger, lines } = capture();
    logger.info("x", {
      apiKey: "SECRET",
      authorization: "Bearer X",
      Cookie: "sid=1",
      token: "t",
      password: "p",
      normal: "ok",
    });
    const r = lines[0].record;

    expect(r.apiKey).toBe("[REDACTED]");
    expect(r.authorization).toBe("[REDACTED]");
    expect(r.Cookie).toBe("[REDACTED]");
    expect(r.token).toBe("[REDACTED]");
    expect(r.password).toBe("[REDACTED]");
    expect(r.normal).toBe("ok");
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(JSON.stringify(r)).not.toContain("Bearer X");
  });

  it("strips control characters from string values (log-injection defense)", () => {
    const { logger, lines } = capture();
    logger.info("x", { path: "/a\nFAKE-LEVEL: error\r/b\tend" });
    expect(lines[0].record.path).toBe("/a FAKE-LEVEL: error /b end");
  });

  it("respects the minimum level", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", sink: (_l, line) => lines.push(line) });
    logger.debug("drop");
    logger.info("drop");
    logger.warn("keep");
    logger.error("keep");
    expect(lines).toHaveLength(2);
  });

  it("emits nothing when silent", () => {
    const lines: string[] = [];
    const logger = createLogger({ silent: true, sink: (_l, line) => lines.push(line) });
    logger.error("boom");
    expect(lines).toHaveLength(0);
  });
});
