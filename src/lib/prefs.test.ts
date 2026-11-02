import { describe, expect, it } from "vitest";

import { DEFAULT_PREFS, parsePrefs, parseSizes } from "./prefs";

describe("parsePrefs", () => {
  it("reads a stored set whole", () => {
    const stored = { orderType: "limit", slippageBps: 25, size: "last", confirmBatch: false, chartLines: false };
    expect(parsePrefs(JSON.stringify(stored))).toEqual(stored);
  });

  it("gives the defaults for nothing, text that is not JSON, and JSON that is not a record", () => {
    for (const raw of [null, "", "{", "null", "7", '"limit"', "[1,2]", "true"]) expect(parsePrefs(raw), String(raw)).toEqual(DEFAULT_PREFS);
  });

  it("falls back field by field, keeping the fields that are valid", () => {
    const raw = JSON.stringify({ orderType: "iceberg", slippageBps: 7, size: "largest", confirmBatch: "yes", chartLines: false });
    expect(parsePrefs(raw)).toEqual({ ...DEFAULT_PREFS, chartLines: false });
    expect(parsePrefs(JSON.stringify({ slippageBps: "25", orderType: "stop" }))).toEqual({ ...DEFAULT_PREFS, orderType: "stop" });
  });

  it("offers only the slippage bounds the ticket has", () => {
    expect(parsePrefs(JSON.stringify({ slippageBps: 50 })).slippageBps).toBe(50);
    expect(parsePrefs(JSON.stringify({ slippageBps: 1_000_000 })).slippageBps).toBe(DEFAULT_PREFS.slippageBps);
    expect(parsePrefs(JSON.stringify({ slippageBps: -5 })).slippageBps).toBe(DEFAULT_PREFS.slippageBps);
  });
});

describe("parseSizes", () => {
  it("keeps the sizes the ticket accepts, by market, and drops the rest", () => {
    const raw = JSON.stringify({ 1: "0.5", 2: "abc", 3: 4, "x": "1", 0: "1", 5: "0.0000001", 6: "2.25" });
    expect(parseSizes(raw)).toEqual({ 1: "0.5", 6: "2.25" });
  });

  it("is empty for nothing and for a value that is not a record", () => {
    for (const raw of [null, "", "{", "[]", "3"]) expect(parseSizes(raw), String(raw)).toEqual({});
  });

  it("keeps at most 200 markets", () => {
    const raw = JSON.stringify(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i + 1, "1"])));
    expect(Object.keys(parseSizes(raw))).toHaveLength(200);
  });
});
