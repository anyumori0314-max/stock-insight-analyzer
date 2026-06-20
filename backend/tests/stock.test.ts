import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers";
import { tickerSchema } from "../src/schemas/stock";

describe("GET /api/stock/:ticker", () => {
  it("returns 501 NOT_IMPLEMENTED for a valid ticker (no external call)", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/AAPL");

    expect(res.status).toBe(501);
    expect(res.body).toEqual({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Stock data integration is not available yet.",
      },
    });
  });

  it("accepts lowercase tickers (normalized, not rejected) -> 501", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/aapl");

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("rejects empty / whitespace ticker with 400 INVALID_TICKER", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/%20");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TICKER");
  });

  it("rejects invalid characters with 400 INVALID_TICKER", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/INVALID!!!");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TICKER");
  });

  it("rejects a too-long ticker with 400 INVALID_TICKER", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/stock/ABCDEFGHIJKLMNOP");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TICKER");
  });

  it("rejects path-traversal-like input (never served as a ticker)", async () => {
    const app = buildTestApp();

    // Traversal-style inputs must always be rejected with a unified error body
    // and never reach the handler as a ticker (i.e. never 200/501). Rejection
    // may happen at the router layer (404, the path is normalized away) or at
    // the schema layer (400) — both are safe and return unified JSON.
    const cases = [
      "/api/stock/%2e%2e", // ".."
      "/api/stock/%2e%2e%2f%2e%2e%2fetc", // "../../etc"
      "/api/stock/AB%2fCD", // "AB/CD" (embedded slash)
    ];

    for (const url of cases) {
      const res = await request(app).get(url);
      expect([400, 404]).toContain(res.status);
      expect(["INVALID_TICKER", "NOT_FOUND"]).toContain(res.body.error.code);
    }
  });
});

describe("tickerSchema — accepted forms (normalized to uppercase)", () => {
  const accepted: Array<[string, string]> = [
    ["AAPL", "AAPL"],
    ["aapl", "AAPL"],
    ["  aapl ", "AAPL"], // trimmed
    ["BRK.B", "BRK.B"],
    ["brk.b", "BRK.B"],
    ["BRK-B", "BRK-B"],
    ["BF.A", "BF.A"],
    ["ABCDEFGHIJ", "ABCDEFGHIJ"], // exactly 10 allowed characters
  ];

  it.each(accepted)("accepts %j -> %j", (input, expected) => {
    expect(tickerSchema.parse(input)).toBe(expected);
  });
});

describe("tickerSchema — rejected forms", () => {
  const rejected: Array<[string, string]> = [
    ["empty string", ""],
    ["whitespace only", "   "],
    ["11 characters", "ABCDEFGHIJK"],
    ["leading traversal", "../AAPL"],
    ["encoded traversal", "%2E%2E%2FAAPL"],
    ["embedded slash", "RDS/A"],
    ["double dot", ".."],
    ["leading separator", "-AAPL"],
    ["trailing separator", "AAPL."],
    ["consecutive separators", "AA..PL"],
    ["japanese", "日本語"],
    ["fullwidth alnum", "ＡＡＰＬ"],
    ["latin small long s (folds to S)", "ſ"],
    ["dotless i (folds to I)", "ı"],
    ["NUL control character", "AA" + String.fromCharCode(0) + "PL"],
    ["tab control character", "AA\tPL"],
    ["embedded space", "AA PL"],
    ["disallowed symbol", "AAPL!"],
  ];

  it.each(rejected)("rejects %s", (_label, input) => {
    expect(tickerSchema.safeParse(input).success).toBe(false);
  });

  it("rejects Unicode look-alikes that would fold to ASCII when uppercased", () => {
    // Guards the validation-order fix: the ASCII allow-list is applied BEFORE
    // uppercasing, so these never sneak through as S / I.
    expect("ſ".toUpperCase()).toBe("S");
    expect(tickerSchema.safeParse("ſ").success).toBe(false);
    expect(tickerSchema.safeParse("ı").success).toBe(false);
  });
});
