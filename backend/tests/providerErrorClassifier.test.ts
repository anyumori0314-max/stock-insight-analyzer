import { describe, expect, it } from "vitest";

import {
  classifyProviderMessage,
  type ProviderMessageChannel,
} from "../src/services/providerErrorClassifier";

describe("classifyProviderMessage — API key / entitlement", () => {
  const apiKeyMessages = [
    "the parameter apikey is invalid or missing.",
    "Invalid API key.",
    "invalid key provided",
    "This is a premium endpoint. Subscribe to unlock it.",
    "premium membership required for this function.",
    "Your plan does not have the entitlement for this data.",
    "unsupported function for your current plan",
    "This endpoint is unsupported on the free tier.",
  ];

  it.each(apiKeyMessages)("classifies %j as API_KEY_INVALID", (message) => {
    expect(classifyProviderMessage("information", message)).toBe("API_KEY_INVALID");
  });
});

describe("classifyProviderMessage — rate limit", () => {
  const rateMessages = [
    "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.",
    "Our standard API rate limit is 25 requests per day.",
    "You have reached your daily quota.",
    "rate limit exceeded",
    "Too many requests, please slow down.",
    "API call frequency is 5 calls per minute and 500 calls per day.",
  ];

  it.each(rateMessages)("classifies %j as PROVIDER_RATE_LIMITED", (message) => {
    expect(classifyProviderMessage("information", message)).toBe("PROVIDER_RATE_LIMITED");
  });

  it("prioritizes rate-limit over premium upsell wording", () => {
    const message =
      "Our standard API rate limit is 25 requests per day. Please subscribe to a premium plan to remove the limit.";
    expect(classifyProviderMessage("information", message)).toBe("PROVIDER_RATE_LIMITED");
  });
});

describe("classifyProviderMessage — symbol", () => {
  const symbolMessages = [
    "Invalid API call. Please retry or visit the documentation.",
    "Invalid symbol",
    "symbol not found",
    "the symbol you requested is invalid",
    "malformed symbol",
    "no data for symbol ZZZZ",
  ];

  it.each(symbolMessages)("classifies %j as SYMBOL_NOT_FOUND", (message) => {
    expect(classifyProviderMessage("errorMessage", message)).toBe("SYMBOL_NOT_FOUND");
  });
});

describe("classifyProviderMessage — provider outage", () => {
  const outageMessages = [
    "The service is temporarily unavailable.",
    "This endpoint is undergoing maintenance.",
    "service unavailable",
    "unexpected upstream response",
  ];

  it.each(outageMessages)("classifies %j as PROVIDER_UNAVAILABLE", (message) => {
    expect(classifyProviderMessage("information", message)).toBe("PROVIDER_UNAVAILABLE");
  });
});

describe("classifyProviderMessage — channel fallback for unknown text", () => {
  const cases: Array<[ProviderMessageChannel, string]> = [
    ["errorMessage", "SYMBOL_NOT_FOUND"],
    ["note", "PROVIDER_RATE_LIMITED"],
    ["information", "PROVIDER_UNAVAILABLE"],
  ];

  it.each(cases)("unknown %s message -> %s", (channel, expected) => {
    expect(classifyProviderMessage(channel, "some entirely unrecognized advisory text")).toBe(
      expected
    );
  });

  it("treats empty/undefined messages by channel fallback", () => {
    expect(classifyProviderMessage("note", undefined)).toBe("PROVIDER_RATE_LIMITED");
    expect(classifyProviderMessage("information", "")).toBe("PROVIDER_UNAVAILABLE");
  });
});
