/** Tests for the House page's figures: the latest applied set_params, caps from the engine's rule, utilisation, and queue totals. */

import { describe, expect, it } from "vitest";

import type { EngineCommand, EngineEvent } from "./engine/types";
import { fixedFromInt } from "./fixed";
import { capFor, queueTotals, setParamsOf, utilBps } from "./house";

const SET_PARAMS = {
  action: "set_params",
  profit_fee_bps: 1000,
  closeout_level_bps: 5000,
  house_total_cap_bps: 20000,
  house_total_cap_floor: "2000000",
} as const;

const PARAMS_FIELDS = {
  profit_fee_bps: 1000,
  closeout_level_bps: 5000,
  house_total_cap_bps: 20000,
  house_total_cap_floor: "2000000",
};

const ADMIN_REJECTED: EngineEvent = { type: "admin_rejected", reason: "out of bounds" };

describe("setParamsOf", () => {
  it("reads a genesis `admin` set_params", () => {
    const cmd = { type: "admin", ...SET_PARAMS } as unknown as EngineCommand;
    expect(setParamsOf(cmd, [])).toEqual(PARAMS_FIELDS);
  });

  it("reads a `signed_admin` set_params", () => {
    const cmd = { type: "signed_admin", command: { ...SET_PARAMS } } as unknown as EngineCommand;
    expect(setParamsOf(cmd, [])).toEqual(PARAMS_FIELDS);
  });

  it("ignores a set_params the engine rejected, whose values never applied", () => {
    const cmd = { type: "signed_admin", command: { ...SET_PARAMS } } as unknown as EngineCommand;
    expect(setParamsOf(cmd, [ADMIN_REJECTED])).toBeNull();
  });

  it("answers null for other commands", () => {
    const upsert = { type: "admin", action: "upsert_market", id: 1 } as unknown as EngineCommand;
    const tick = { type: "tick" } as EngineCommand;
    const signedUpsert = { type: "signed_admin", command: { action: "upsert_market" } } as unknown as EngineCommand;
    for (const cmd of [upsert, tick, signedUpsert]) expect(setParamsOf(cmd, [])).toBeNull();
  });

  it("answers null for a floor an older protocol version carries none of, or a malformed one", () => {
    const legacy = {
      type: "admin", action: "set_params", profit_fee_bps: 1000, closeout_level_bps: 5000, house_total_cap_bps: 20000,
    } as unknown as EngineCommand;
    const malformed = { type: "admin", ...SET_PARAMS, house_total_cap_floor: "not a decimal" } as unknown as EngineCommand;
    expect(setParamsOf(legacy, [])).toBeNull();
    expect(setParamsOf(malformed, [])).toBeNull();
  });
});

describe("capFor", () => {
  it("takes the NAV share when it exceeds the floor", () => {
    // 20% of $20,000,000 = $4,000,000, above the $2,000,000 floor.
    expect(capFor(fixedFromInt(20_000_000), 2000, fixedFromInt(2_000_000))).toBe(fixedFromInt(4_000_000));
  });

  it("takes the floor when the NAV share is smaller, and when NAV is negative", () => {
    expect(capFor(fixedFromInt(5_000_000), 2000, fixedFromInt(2_000_000))).toBe(fixedFromInt(2_000_000));
    expect(capFor(fixedFromInt(-1), 2000, fixedFromInt(2_000_000))).toBe(fixedFromInt(2_000_000));
  });

  it("truncates the share toward zero, as the engine's mul_bps does", () => {
    // 20% of a third of a dollar truncates below the share of a full dollar.
    const nav = fixedFromInt(1) / 3n;
    expect(capFor(nav, 2000, 0n)).toBe(66_666_666n);
  });
});

describe("utilBps", () => {
  it("states the share in basis points, truncated", () => {
    expect(utilBps(fixedFromInt(1), fixedFromInt(4))).toBe(2500);
    expect(utilBps(fixedFromInt(1) / 3n, fixedFromInt(1))).toBe(3333);
    expect(utilBps(0n, fixedFromInt(4))).toBe(0);
    expect(utilBps(fixedFromInt(5), fixedFromInt(4))).toBe(12_500);
  });

  it("answers null when the cap is not positive", () => {
    expect(utilBps(fixedFromInt(1), 0n)).toBeNull();
    expect(utilBps(fixedFromInt(1), fixedFromInt(-2))).toBeNull();
  });
});

describe("queueTotals", () => {
  const entry = (remaining: string) => ({ position: 1, account: "0x00a1", amount: "10", remaining, requested_seq: 2 });

  it("sums every entry across pages and keeps the last page's seq", () => {
    const pages = [
      { seq: 10, queue: [entry("100.5"), entry("2")] },
      { seq: 12, queue: [entry("0.000000001")] },
    ];
    expect(queueTotals(pages, true, true)).toEqual({ count: 3, remaining: 102500000001n, seq: 12, complete: true, stable: true });
  });

  it("marks a walk the page cap cut short, and pages that mix a changing queue's seqs", () => {
    const pages = [{ seq: 10, queue: [entry("1")] }];
    expect(queueTotals(pages, false, true)).toEqual({ count: 1, remaining: 1_000_000_000n, seq: 10, complete: false, stable: true });
    expect(queueTotals(pages, true, false)).toEqual({ count: 1, remaining: 1_000_000_000n, seq: 10, complete: true, stable: false });
  });

  it("throws on a malformed remainder, which the engine never sends", () => {
    expect(() => queueTotals([{ seq: 10, queue: [entry("x")] }], true, true)).toThrow("malformed queue remainder");
  });
});
