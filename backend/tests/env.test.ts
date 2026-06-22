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

  it("boots in production without an Alpha Vantage API key (readiness flags it later)", () => {
    // A missing key is NOT a startup failure — the app boots and /api/ready
    // reports not_ready. ALLOWED_ORIGINS is required in production, so it is set.
    const env = loadEnv({
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://app.example",
      ALPHA_VANTAGE_API_KEY: "",
    });
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

  it("defaults the cache TTL to 6 hours (21600s) and max entries to 100", () => {
    const env = loadEnv({});
    expect(env.STOCK_CACHE_TTL_SECONDS).toBe(21_600);
    expect(env.STOCK_CACHE_MAX_ENTRIES).toBe(100);
  });

  it("accepts a custom cache TTL up to 24 hours", () => {
    expect(loadEnv({ STOCK_CACHE_TTL_SECONDS: "3600" }).STOCK_CACHE_TTL_SECONDS).toBe(3600);
    expect(loadEnv({ STOCK_CACHE_TTL_SECONDS: "86400" }).STOCK_CACHE_TTL_SECONDS).toBe(86_400);
  });

  it("defaults the data mode to live", () => {
    expect(loadEnv({}).STOCK_DATA_MODE).toBe("live");
  });

  it("defaults the provider max points to 120 and accepts a custom value", () => {
    expect(loadEnv({}).ALPHA_VANTAGE_MAX_POINTS).toBe(120);
    expect(loadEnv({ ALPHA_VANTAGE_MAX_POINTS: "250" }).ALPHA_VANTAGE_MAX_POINTS).toBe(250);
  });

  it("accepts an explicit mock data mode outside production", () => {
    expect(loadEnv({ STOCK_DATA_MODE: "mock" }).STOCK_DATA_MODE).toBe("mock");
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

  it("rejects a zero / negative / oversized cache TTL", () => {
    expect(() => loadEnv({ STOCK_CACHE_TTL_SECONDS: "0" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ STOCK_CACHE_TTL_SECONDS: "-1" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ STOCK_CACHE_TTL_SECONDS: "86401" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ STOCK_CACHE_TTL_SECONDS: "1.5" })).toThrow(/Invalid environment variables/);
  });

  it("rejects a zero / negative cache max-entries", () => {
    expect(() => loadEnv({ STOCK_CACHE_MAX_ENTRIES: "0" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ STOCK_CACHE_MAX_ENTRIES: "-5" })).toThrow(/Invalid environment variables/);
  });

  it("rejects an unknown data mode", () => {
    expect(() => loadEnv({ STOCK_DATA_MODE: "fake" })).toThrow(/Invalid environment variables/);
  });

  it("rejects a zero / negative / non-integer provider max points", () => {
    expect(() => loadEnv({ ALPHA_VANTAGE_MAX_POINTS: "0" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ ALPHA_VANTAGE_MAX_POINTS: "-10" })).toThrow(/Invalid environment variables/);
    expect(() => loadEnv({ ALPHA_VANTAGE_MAX_POINTS: "1.5" })).toThrow(/Invalid environment variables/);
  });

  it("rejects mock data mode in production", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", STOCK_DATA_MODE: "mock", ALLOWED_ORIGINS: "https://app.example" })
    ).toThrow(/Invalid environment variables/);
  });

  it("rejects production with no ALLOWED_ORIGINS", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/Invalid environment variables/);
    // The failure names the offending variable (and never a secret value).
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/ALLOWED_ORIGINS/);
  });

  it("accepts production once ALLOWED_ORIGINS is configured (live by default)", () => {
    const env = loadEnv({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example" });
    expect(env.NODE_ENV).toBe("production");
    expect(env.ALLOWED_ORIGINS).toEqual(["https://app.example"]);
    expect(env.STOCK_DATA_MODE).toBe("live");
  });

  it("does not require ALLOWED_ORIGINS outside production", () => {
    expect(() => loadEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: "test", STOCK_DATA_MODE: "mock" })).not.toThrow();
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
