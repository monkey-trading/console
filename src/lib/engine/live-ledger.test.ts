import { describe, expect, it } from "vitest";

import { EngineError } from "./client";
import { decodeSchedule, periodOf, periodStart } from "./emission-schedule";
import { historyPath, readEmissionSchedule } from "./live-ledger";

describe("historyPath", () => {
  it("asks for a kind, a limit and a cursor", () => {
    expect(historyPath("0xabc", { kind: "fill", limit: 100, before: "7:2" })).toBe("/v1/accounts/0xabc/history?kind=fill&limit=100&before=7%3A2");
  });

  it("asks for nothing more than it is given", () => {
    expect(historyPath("0xabc", {})).toBe("/v1/accounts/0xabc/history");
    expect(historyPath("0xabc", { limit: 100 })).toBe("/v1/accounts/0xabc/history?limit=100");
  });
});

const wire = { start_ms: 1_000, period_ms: 600_000, period: 12 };

describe("readEmissionSchedule", () => {
  it("reads the emissions group of the signed answer", async () => {
    const schedule = await readEmissionSchedule(async () => ({ emissions: wire }));
    expect(schedule).toEqual({ startMs: 1_000, periodMs: 600_000, period: 12 });
  });

  it("is null from a node that predates the route", async () => {
    expect(await readEmissionSchedule(async () => { throw new EngineError(404, "not found"); })).toBeNull();
  });

  it("is null from a node that reports no emissions", async () => {
    expect(await readEmissionSchedule(async () => ({ emissions: null }))).toBeNull();
  });

  it("rejects on any other failure, so it is not mistaken for an old node", async () => {
    await expect(readEmissionSchedule(async () => { throw new EngineError(503, "busy"); })).rejects.toThrow("busy");
    await expect(readEmissionSchedule(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  });
});

describe("the schedule", () => {
  it("refuses a period length that cannot divide time", () => {
    expect(decodeSchedule({ ...wire, period_ms: 0 })).toBeNull();
    expect(decodeSchedule({ ...wire, period_ms: -5 })).toBeNull();
    expect(decodeSchedule({ ...wire, start_ms: 1.5 })).toBeNull();
  });

  it("keeps a null open period, before the schedule starts", () => {
    expect(decodeSchedule({ ...wire, period: null })?.period).toBeNull();
  });

  it("puts a stamp in floor((ts - start) / period), and a period starts at start + period * length", () => {
    const schedule = { startMs: 1_000, periodMs: 600_000, period: null };
    expect(periodOf(schedule, 1_000)).toBe(0);
    expect(periodOf(schedule, 600_999)).toBe(0);
    expect(periodOf(schedule, 601_000)).toBe(1);
    expect(periodOf(schedule, 999)).toBe(-1);
    expect(periodStart(schedule, 3)).toBe(1_801_000);
  });
});
