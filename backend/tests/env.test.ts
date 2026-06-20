import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

// `loadEnv(source)` is pure: it reads an explicit object, never process.env, so
// these tests cannot leak into module cache or affect other tests.

describe("loadEnv — valid input", () => {
  it("applies defaults when only required-by-phase values are absent", () => {
    const env = loadEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3001);
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.ALLOWED_ORIGINS).toEqual([]);
    expect(env.ALPHA_VANTAGE_API_KEY).toBeUndefined();
  });

  it("loads Phase 1 successfully without an Alpha Vantage API key", () => {
    const env = loadEnv({ NODE_ENV: "production", ALPHA_VANTAGE_API_KEY: "" });
    expect(env.ALPHA_VANTAGE_API_KEY).toBeUndefined();
  });

  it("parses multiple ALLOWED_ORIGINS (trimmed, empties dropped)", () => {
    const env = loadEnv({ ALLOWED_ORIGINS: " https://a.example , ,https://b.example " });
    expect(env.ALLOWED_ORIGINS).toEqual(["https://a.example", "https://b.example"]);
  });

  it("treats an empty ALLOWED_ORIGINS as no extra origins", () => {
    const env = loadEnv({ ALLOWED_ORIGINS: "" });
    expect(env.ALLOWED_ORIGINS).toEqual([]);
  });

  it("accepts a numeric TRUST_PROXY hop count", () => {
    expect(loadEnv({ TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
  });
});

describe("loadEnv — invalid input is rejected at startup", () => {
  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow(/Invalid environment variables/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadEnv({ PORT: "abc" })).toThrow(/Invalid environment variables/);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => loadEnv({ PORT: "70000" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ PORT: "0" })).toThrow(/Invalid environment variables/);
  });

  it("rejects a non-integer or negative TRUST_PROXY", () => {
    expect(() => loadEnv({ TRUST_PROXY: "true" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ TRUST_PROXY: "-1" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ TRUST_PROXY: "1.5" })).toThrow(/Invalid environment variables/);
  });
});

describe("loadEnv — secrets never leak", () => {
  it("does not include the API key value in validation errors", () => {
    const secret = "SUPER-SECRET-KEY-DO-NOT-LEAK";
    try {
      loadEnv({ NODE_ENV: "nonsense", ALPHA_VANTAGE_API_KEY: secret });
      throw new Error("expected loadEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
