/** What the claim cards may say while the node holds no proof (monkey-trading/console#260). */

import { describe, expect, it } from "vitest";

import type { StakingPosition } from "../engine/staking";
import type { ActivityEntry, MonkeyView } from "../engine/stats-types";
import { LOADING, ready, type Read } from "./figures";
import { pendingDistribution, pendingEmission, proofAwaited } from "./pending";

const ME = "0x00000000000000000000000000000000000000aa";
const MONKEY_UNIT = 10n ** 18n;

const overviewWith = (over: Partial<NonNullable<MonkeyView["distribution"]>> | null, period: number | null = 7, total = 12_000n * MONKEY_UNIT): Read<MonkeyView> => ready({
  seq: 1, time_ms: 0, begins_ms: null, begins_seq: null, from_genesis: true,
  emissions: period === null ? null : { start_ms: 0, period_ms: 600_000, period_budget: "1", halving_periods: 1, period, current_budget: "1", next_halving_ms: null, max_supply: "1", allocated: "0", cancelled: "0" },
  staking: { total_staked: total.toString(), stakers: 1, cooldown_ms: 1 },
  distribution: over === null ? null : {
    start_ms: 0, epoch_ms: 1, liquidity_floor: "0", nav: "0", excess_usd: null, excess_seq: null, epoch: 3, last_closed_epoch: 2, last_closed_ms: 1, next_close_ms: 2, distributed_usdc_units: "0",
    last_distribution: { epoch: 2, closed_ms: 1, nav: "0", floor: "0", excess_usdc_units: "100089412000", allocated_usdc_units: "100089412000" }, ...over,
  },
});
const stakes = (staked: bigint): Read<StakingPosition> => ready({ stakingEnabled: true, staked, unstaking: null, balance: 0n, distributionsClaimed: 0n, latestSeq: 0 });

describe("pendingDistribution", () => {
  it("says an epoch paid and estimates a 100% staker's share when the node holds no proof yet", () => {
    expect(pendingDistribution(overviewWith({}), stakes(12_000n * MONKEY_UNIT), null)).toEqual({ kind: "awaiting", epoch: 2, paid: 100_089_412_000n, share: 100_089_412_000n, staker: true });
  });

  it("estimates a partial stake's share in integer arithmetic", () => {
    expect(pendingDistribution(overviewWith({}), stakes(3_000n * MONKEY_UNIT), null)).toMatchObject({ kind: "awaiting", share: 25_022_353_000n });
  });

  it("gives no share while the node's total has not caught up with the account's own stake change, or counts none", () => {
    expect(pendingDistribution(overviewWith({}), stakes(12_000n * MONKEY_UNIT), "9000")).toMatchObject({ kind: "awaiting", share: null, staker: true });
    expect(pendingDistribution(overviewWith({}, 7, 0n), stakes(12_000n * MONKEY_UNIT), null)).toMatchObject({ kind: "awaiting", share: null });
  });

  it("keeps the plain line only for an account that stakes nothing, or when no epoch has paid", () => {
    expect(pendingDistribution(overviewWith({}), stakes(0n), null)).toEqual({ kind: "none" });
    expect(pendingDistribution(overviewWith({ last_distribution: null }), stakes(1n), null)).toEqual({ kind: "none" });
    expect(pendingDistribution(overviewWith({ last_distribution: { epoch: 2, closed_ms: 1, nav: "0", floor: "0", excess_usdc_units: "0", allocated_usdc_units: "0" } }), stakes(1n), null)).toEqual({ kind: "none" });
    expect(pendingDistribution(overviewWith(null), stakes(1n), null)).toEqual({ kind: "none" });
  });

  it("draws no verdict until the totals and the account's stake have landed", () => {
    expect(pendingDistribution(LOADING, stakes(1n), null)).toEqual({ kind: "reading" });
    expect(pendingDistribution(overviewWith({}), LOADING, null)).toEqual({ kind: "reading" });
    expect(pendingDistribution(overviewWith({}), { status: "failed", value: null, message: "no" }, null)).toEqual({ kind: "reading" });
  });

  it("still says an epoch paid for an account whose stake cannot be read, without claiming it staked", () => {
    expect(pendingDistribution(overviewWith({}), { status: "unavailable", value: null, message: null }, null)).toMatchObject({ kind: "awaiting", staker: null, share: null });
  });
});

const loss = (period: number | null, account = ME, type: ActivityEntry["type"] = "loss_close"): ActivityEntry => ({ id: "1", seq: 1, ts: 1, type, account, amount: "1", period });
const feed = (...entries: ActivityEntry[]) => ready({ entries, next: null, begins_ms: null, begins_seq: null, from_genesis: true, truncated: false, retained_from_ms: null });

describe("pendingEmission", () => {
  it("awaits the proof for a loss the account closed in a period that has since closed", () => {
    expect(pendingEmission(feed(loss(5), loss(6, ME.toUpperCase().replace("0X", "0x"))), overviewWith({}, 7), ME)).toEqual({ kind: "awaiting", period: 6 });
  });

  it("does not for the open period, another account's loss, or an entry that is not a loss", () => {
    expect(pendingEmission(feed(loss(7)), overviewWith({}, 7), ME)).toEqual({ kind: "none" });
    expect(pendingEmission(feed(loss(5, "0x00000000000000000000000000000000000000bb")), overviewWith({}, 7), ME)).toEqual({ kind: "none" });
    expect(pendingEmission(feed(loss(null, ME, "stake")), overviewWith({}, 7), ME)).toEqual({ kind: "none" });
  });

  it("draws no verdict before the feed and the totals have landed", () => {
    expect(pendingEmission(LOADING, overviewWith({}), ME)).toEqual({ kind: "reading" });
    expect(pendingEmission(feed(loss(5)), LOADING, ME)).toEqual({ kind: "reading" });
  });
});

describe("proofAwaited", () => {
  const reads = { overview: overviewWith({}), activity: feed(), position: stakes(1n), proof: ready(null), entitlement: null, unmirroredTotal: null, account: ME };

  it("is true while an epoch paid a staker and no distribution proof exists, and false once it does", () => {
    expect(proofAwaited(reads)).toBe(true);
    expect(proofAwaited({ ...reads, proof: { status: "loading", value: null, message: null } })).toBe(false);
    expect(proofAwaited({ ...reads, proof: ready({ seq: 1, root: "0x", account: ME, entitled: "1", siblings: [] }) })).toBe(false);
  });

  it("is true for a closed-period loss with no entitlement, and false with one", () => {
    const lossy = { ...reads, position: stakes(0n), activity: feed(loss(5)) };
    expect(proofAwaited(lossy)).toBe(true);
    expect(proofAwaited({ ...lossy, entitlement: { seq: 1, root: "0x", account: ME, entitled: "1", siblings: [] } })).toBe(false);
  });
});
