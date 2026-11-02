import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import type { MonkeySeriesMetric, SeriesResolution } from "../engine/stats-types";
import { fixedFromInt, fixedToWire } from "../fixed";
import { MONKEY_UNIT } from "../format";
import { houseNav } from "./accounts";
import { recordEmissionResult } from "./emissions";
import { advance } from "./step";
import { activityPage, closeDistributionEpochs, completeUnstake, distributionProof, monkeySeries, overview, stake, startUnstake, walletBalance } from "./monkey";
import { COOLDOWN_MS, EPOCH_MS, FLOOR_USD, HALVING_PERIODS, HISTORY_MS, PERIOD_MS } from "./monkey-state";
import { START } from "./test-helpers";
import { createMockNode } from "./index";

/** A series read as the page asks for one: from the record's start (or `fromMs`), to the clock, a page of `limit`. */
function series(state: ReturnType<typeof node>, query: { metric: MonkeySeriesMetric; resolution: SeriesResolution; fromMs?: number; limit?: number }) {
  return monkeySeries(state, { market: null, fromMs: query.fromMs ?? 0, toMs: Number.MAX_SAFE_INTEGER, limit: query.limit ?? 500, ...query });
}

const ME = "0xabc0000000000000000000000000000000000001";

function node() {
  const made = createMockNode(START);
  made.client.state.monkey.seededBalance.set(ME, 1_000n * MONKEY_UNIT);
  return made.client.state;
}

describe("the mock's MONKEY overview", () => {
  it("halves the budget once inside the history and counts the schedule's maximum supply", () => {
    const view = overview(node());
    const emissions = view.emissions;
    expect(emissions?.period_budget).toBe((2_000n * MONKEY_UNIT).toString());
    expect(emissions?.current_budget).toBe((1_000n * MONKEY_UNIT).toString());
    expect(emissions?.max_supply).toBe((2n * BigInt(HALVING_PERIODS) * 2_000n * MONKEY_UNIT).toString());
    expect(emissions?.next_halving_ms).toBeGreaterThan(view.time_ms);
    expect(view.from_genesis).toBe(true);
  });

  it("puts the next close one epoch after the last one", () => {
    const distribution = overview(node()).distribution;
    expect(distribution?.next_close_ms).toBe((distribution?.last_closed_ms ?? 0) + EPOCH_MS);
  });
});

describe("staking in the mock", () => {
  it("moves tokens from the wallet into the stake, raises the total the node counts, and records the event", () => {
    const state = node();
    const before = BigInt(overview(state).staking?.total_staked ?? "0");
    stake(state, ME, 400n * MONKEY_UNIT);
    expect(walletBalance(state, ME)).toBe(600n * MONKEY_UNIT);
    expect(BigInt(overview(state).staking?.total_staked ?? "0")).toBe(before + 400n * MONKEY_UNIT);
    expect(activityPage(state, { limit: 1 }).entries[0]).toMatchObject({ type: "stake", account: ME, amount: (400n * MONKEY_UNIT).toString() });
  });

  it("refuses to stake more than the wallet holds, or nothing", () => {
    const state = node();
    expect(() => stake(state, ME, 1_001n * MONKEY_UNIT)).toThrow("less MONKEY");
    expect(() => stake(state, ME, 0n)).toThrow("more than zero");
  });

  it("keeps an unstake counted as staked until it completes, and refuses to complete it early", () => {
    const state = node();
    stake(state, ME, 400n * MONKEY_UNIT);
    const staked = BigInt(overview(state).staking?.total_staked ?? "0");
    startUnstake(state, ME, 100n * MONKEY_UNIT);
    expect(BigInt(overview(state).staking?.total_staked ?? "0")).toBe(staked);
    // Tokens in their cooldown have left the wallet and are not back yet.
    expect(walletBalance(state, ME)).toBe(600n * MONKEY_UNIT);
    expect(() => completeUnstake(state, ME)).toThrow("cooldown has not passed");
    state.now += COOLDOWN_MS;
    const counted = BigInt(overview(state).staking?.total_staked ?? "0");
    completeUnstake(state, ME);
    expect(walletBalance(state, ME)).toBe(700n * MONKEY_UNIT);
    expect(BigInt(overview(state).staking?.total_staked ?? "0")).toBe(counted - 100n * MONKEY_UNIT);
    expect(activityPage(state, { limit: 1 }).entries[0]?.type).toBe("unstake");
  });

  it("refuses to unstake more than is staked", () => {
    const state = node();
    stake(state, ME, 10n * MONKEY_UNIT);
    expect(() => startUnstake(state, ME, 11n * MONKEY_UNIT)).toThrow("not staked that much");
  });
});

describe("distribution epochs in the mock", () => {
  it("pays a staker its share at each close it was staked for, and posts a checkpoint with it", () => {
    const state = node();
    stake(state, ME, 500n * MONKEY_UNIT);
    expect(() => distributionProof(state, ME)).toThrow(EngineError);
    // Advance the clock past several closes, one of them (every seventh epoch) paying nothing.
    advance(state, state.now + 4 * EPOCH_MS);
    const proof = distributionProof(state, ME);
    expect(BigInt(proof.entitled)).toBeGreaterThan(0n);
    expect(proof.seq).toBe(state.postedSeq);
    const closed = state.monkey.epochs.filter((close) => close.closedMs > START);
    expect(closed.length).toBeGreaterThanOrEqual(4);
  });

  it("closes each epoch once", () => {
    const state = node();
    advance(state, state.now + 2 * EPOCH_MS);
    const count = state.monkey.epochs.length;
    closeDistributionEpochs(state);
    expect(state.monkey.epochs).toHaveLength(count);
  });
});

describe("the mock's series", () => {
  it("starts where the node's data begins and pages with `next`", () => {
    const state = node();
    const first = series(state, { metric: "total_staked", resolution: "1h", limit: 10 });
    expect(first.begins_ms).toBe(START - HISTORY_MS);
    expect(first.entries).toHaveLength(10);
    expect(first.next).toBe(first.entries[0]?.ts !== undefined ? (first.entries[0]?.ts ?? 0) + 10 * 3_600_000 : null);
    expect(first.kind).toBe("level");
  });

  it("gives MONKEY per dollar in base units per dollar, and halves it after the halving", () => {
    const state = node();
    const page = series(state, { metric: "monkey_per_loss", resolution: "1d", limit: 40 });
    expect(page.unit).toBe("monkey_base_units_per_usd");
    const perDollar = page.entries.map((entry) => ("value" in entry ? Number(entry.value.split(".")[0]) / 1e18 : NaN));
    // Period budgets of 2,000 then 1,000 MONKEY over weights of 80 to 220 dollars.
    const before = perDollar.slice(0, 3);
    const after = perDollar.slice(-3);
    expect(Math.min(...before)).toBeGreaterThan(2_000 / 220);
    expect(Math.max(...after)).toBeLessThan(1_000 / 80);
    expect(Math.max(...after)).toBeLessThan(Math.min(...before));
  });

  it("sums the epochs of a bucket for distributed_per_epoch and skips buckets with none", () => {
    const state = node();
    const page = series(state, { metric: "distributed_per_epoch", resolution: "1h", fromMs: START - 3_600_000, limit: 5 });
    expect(page.kind).toBe("flow");
    const first = page.entries[0];
    const inside = state.monkey.epochs.filter((close) => close.closedMs >= (first?.ts ?? 0) && close.closedMs < (first?.ts ?? 0) + 3_600_000);
    expect(first && "value" in first ? first.value : null).toBe(inside.reduce((sum, close) => sum + close.allocated, 0n).toString());
  });

  it("makes the cumulative series the running sum of what closed, on top of what the vault had paid", () => {
    const state = node();
    const day = 86_400_000;
    const page = series(state, { metric: "cumulative_distributed", resolution: "1d" });
    const last = page.entries.at(-1);
    const total = state.monkey.epochs.reduce((sum, close) => sum + close.allocated, 0n);
    const before = BigInt((page.entries[0] && "close" in page.entries[0] ? page.entries[0].close : "0"));
    expect(last && "close" in last ? BigInt(last.close) : null).toBe(BigInt(overview(state).distribution?.distributed_usdc_units ?? "0"));
    // The first day's close is the starting figure plus the epochs that closed by its end.
    const firstDayEnd = (page.entries[0]?.ts ?? 0) + day - 1;
    const closedByThen = state.monkey.epochs.filter((close) => close.closedMs <= firstDayEnd).reduce((sum, close) => sum + close.allocated, 0n);
    expect(before - closedByThen).toBe(BigInt(overview(state).distribution?.distributed_usdc_units ?? "0") - total);
  });
});

describe("the mock's allocated total", () => {
  it("grows by exactly what a closing period allocated once the clock runs, never by the generated schedule on top", async () => {
    const made = createMockNode(START);
    const { state } = made.client;
    const before = BigInt(overview(state).emissions?.allocated ?? "0");
    // Whole periods pass with no losses: nothing is allocated, so the total does not move.
    advance(state, state.now + 3 * PERIOD_MS);
    expect(BigInt(overview(state).emissions?.allocated ?? "0")).toBe(before);
    // A period that closes with a loss allocates the budget the mock's closes use, once.
    recordEmissionResult(state, ME, fixedFromInt(-250), 0n);
    state.account(ME).balance = fixedFromInt(1_000);
    advance(state, state.now + PERIOD_MS);
    advance(state, state.now + 1_000);
    expect(BigInt(overview(state).emissions?.allocated ?? "0")).toBe(before + 1_000n * MONKEY_UNIT);
    expect(state.monkey.periods.at(-1)?.amount).toBe(1_000n * MONKEY_UNIT);
    expect(state.monkey.allocatedAt(state.monkey.seededAt)).toBe(before);
  });
});

describe("the mock's activity feed", () => {
  it("pages newest first until the feed is exhausted, each entry once", () => {
    const state = node();
    const ids: number[] = [];
    let before: string | undefined;
    do {
      const page = activityPage(state, before === undefined ? { limit: 200 } : { limit: 200, before });
      ids.push(...page.entries.map((entry) => Number(entry.id)));
      before = page.next ?? undefined;
    } while (before !== undefined);
    expect(ids).toHaveLength(state.monkey.activity.length);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});

describe("the mock's distribution follows the mock's house", () => {
  it("reports the house's own NAV and the excess of it above the floor", () => {
    const state = node();
    const distribution = overview(state).distribution;
    expect(distribution?.nav).toBe(fixedToWire(houseNav(state)));
    expect(distribution?.excess_usd).toBe(fixedToWire(houseNav(state) - FLOOR_USD));
  });

  it("shares the excess in whole USDC at a close, takes it out of the house's cash, and shares only what the house earns after that", () => {
    const state = node();
    const excess = houseNav(state) - FLOOR_USD;
    const cash = state.houseCash;
    advance(state, state.now + EPOCH_MS);
    const first = state.monkey.epochs.at(-1);
    expect(first?.allocated).toBe(excess / 1_000n);
    expect(state.houseCash).toBe(cash - (excess / 1_000n) * 1_000n);
    expect(first?.nav).toBeGreaterThan(FLOOR_USD);
    // Nothing is left above the floor but what the house has earned since.
    advance(state, state.now + EPOCH_MS);
    expect((state.monkey.epochs.at(-1)?.allocated ?? 0n) * 1_000n).toBeLessThan(excess / 10n);
  });

  it("shares nothing while the house sits at or under the floor", () => {
    const state = node();
    state.houseCash = FLOOR_USD - 5n;
    advance(state, state.now + EPOCH_MS);
    expect(state.monkey.epochs.at(-1)?.allocated).toBe(0n);
    expect(overview(state).distribution?.excess_usd).toBe("0");
  });
});

describe("the mock's distribution bound by cash", () => {
  it("shares no more than the house's cash allows when unrealised client losses put NAV above it", () => {
    const state = node();
    // Cash sits on the floor while NAV is far above it, as when clients' open positions are losing.
    state.houseCash = FLOOR_USD;
    const mid = state.markets.get(1)?.mid ?? 0n;
    state.account(ME).positions.set(1, { qty: fixedFromInt(1), entry: mid * 2n });
    expect(houseNav(state)).toBeGreaterThan(state.houseCash);
    advance(state, state.now + EPOCH_MS);
    expect(state.monkey.epochs.at(-1)?.allocated).toBe(0n);
    expect(state.houseCash).toBeGreaterThanOrEqual(FLOOR_USD - 1n);
    expect(overview(state).distribution?.excess_usd).toBe("0");
  });
});

describe("resetting an account in the mock", () => {
  it("forgets what it staked and was distributed, and takes its stake out of the staked total", () => {
    const made = createMockNode(START);
    const { state } = made.client;
    state.monkey.seededBalance.set(ME, 1_000n * MONKEY_UNIT);
    const before = BigInt(overview(state).staking?.total_staked ?? "0");
    stake(state, ME, 400n * MONKEY_UNIT);
    state.monkey.distEntitled.set(ME, 5n);
    state.monkey.distClaimed.set(ME, 3n);
    made.controls.resetAccount(ME);
    expect(state.monkey.staked.has(ME)).toBe(false);
    expect(state.monkey.distEntitled.has(ME)).toBe(false);
    expect(state.monkey.distClaimed.has(ME)).toBe(false);
    expect(walletBalance(state, ME)).toBe(0n);
    expect(BigInt(overview(state).staking?.total_staked ?? "0")).toBe(before);
  });
});
