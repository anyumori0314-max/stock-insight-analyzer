import { describe, expect, it } from "vitest";

import { parsePriceCsv } from "../src/csv/parsePriceCsv";

const LIMITS = { maxRows: 1000 };
const HEADER = "ticker,date,open,high,low,close,volume";

function parse(content: string) {
  return parsePriceCsv(content, LIMITS);
}

describe("parsePriceCsv", () => {
  it("parses a well-formed file into validated bars", () => {
    const result = parse(`${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000\nAAPL,2026-06-02,11,13,10,12,2000`);
    expect(result.fatalError).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0]).toMatchObject({
      ticker: "AAPL",
      tradeDate: "2026-06-01",
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 1000,
      adjustedClose: null,
      currency: null,
      source: "csv",
    });
  });

  it("accepts a UTF-8 BOM and trims header whitespace", () => {
    const bom = "﻿";
    const result = parse(`${bom}ticker , date , open , high , low , close , volume \nMSFT,2026-06-01,10,12,9,11,1000`);
    expect(result.fatalError).toBeNull();
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].ticker).toBe("MSFT");
  });

  it("reads optional adjusted_close and currency columns", () => {
    const result = parse(
      `ticker,date,open,high,low,close,volume,adjusted_close,currency\nAAPL,2026-06-01,10,12,9,11,1000,10.5,usd`
    );
    expect(result.bars[0].adjustedClose).toBe(10.5);
    expect(result.bars[0].currency).toBe("USD");
  });

  it("ignores unknown extra headers but reports them", () => {
    const result = parse(`${HEADER},note\nAAPL,2026-06-01,10,12,9,11,1000,hello`);
    expect(result.fatalError).toBeNull();
    expect(result.unknownHeaders).toContain("note");
    expect(result.bars).toHaveLength(1);
  });

  it("rejects an empty file", () => {
    expect(parse("").fatalError).toMatch(/空/);
  });

  it("rejects a file missing a required header", () => {
    const result = parse(`ticker,date,open,high,low,close\nAAPL,2026-06-01,10,12,9,11`);
    expect(result.fatalError).toMatch(/必須列/);
    expect(result.fatalError).toMatch(/volume/);
  });

  it("rejects a header-only file (no data rows)", () => {
    expect(parse(HEADER).fatalError).toMatch(/データ行/);
  });

  it("flags an impossible/non-real date", () => {
    const result = parse(`${HEADER}\nAAPL,2026-02-30,10,12,9,11,1000`);
    expect(result.bars).toHaveLength(0);
    expect(result.errors[0].reason).toMatch(/日付/);
  });

  it("flags NaN / Infinity OHLC values", () => {
    const result = parse(`${HEADER}\nAAPL,2026-06-01,NaN,12,9,11,1000\nAAPL,2026-06-02,10,Infinity,9,11,1000`);
    expect(result.bars).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].reason).toMatch(/OHLC/);
  });

  it("flags an inconsistent OHLC relationship (high < low)", () => {
    const result = parse(`${HEADER}\nAAPL,2026-06-01,10,8,9,11,1000`);
    expect(result.errors[0].reason).toMatch(/大小関係/);
  });

  it("flags a negative volume and a non-integer / unsafe volume", () => {
    const result = parse(
      `${HEADER}\nAAPL,2026-06-01,10,12,9,11,-5\nAAPL,2026-06-02,10,12,9,11,1.5\nAAPL,2026-06-03,10,12,9,11,9007199254740993`
    );
    expect(result.bars).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
    for (const err of result.errors) expect(err.reason).toMatch(/volume/);
  });

  it("normalizes the ticker to uppercase", () => {
    const result = parse(`${HEADER}\naapl,2026-06-01,10,12,9,11,1000`);
    expect(result.bars[0].ticker).toBe("AAPL");
  });

  it("detects a duplicate ticker+date within the same file", () => {
    const result = parse(`${HEADER}\nAAPL,2026-06-01,10,12,9,11,1000\nAAPL,2026-06-01,10,12,9,11,2000`);
    // The first occurrence parses; the second is flagged as a duplicate. The import
    // service then refuses to persist anything because an error is present.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/重複/);
  });

  it("does not echo a CSV formula-injection payload verbatim in an error", () => {
    const result = parse(`${HEADER}\n=cmd|'/c calc',2026-06-01,10,12,9,11,1000`);
    expect(result.errors).toHaveLength(1);
    // The dangerous leading '=' is neutralized with a leading quote guard.
    expect(result.errors[0].reason).not.toMatch(/（=cmd/);
    expect(result.errors[0].reason).toMatch(/'=cmd/);
  });

  it("rejects a file exceeding the row cap before validating rows", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `AAPL,2026-06-0${i + 1},10,12,9,11,1000`).join("\n");
    const result = parsePriceCsv(`${HEADER}\n${rows}`, { maxRows: 3 });
    expect(result.fatalError).toMatch(/行数が上限/);
    expect(result.bars).toHaveLength(0);
  });

  it("handles quoted fields containing commas", () => {
    const result = parse(`${HEADER},name\nAAPL,2026-06-01,10,12,9,11,1000,"Apple, Inc."`);
    expect(result.fatalError).toBeNull();
    expect(result.bars).toHaveLength(1);
  });
});
