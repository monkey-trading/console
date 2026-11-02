/**
 * The mock node's MONKEY routes (`/v1/monkey`, activity, `/v1/stats/series` and the distribution
 * proof) and what the simulated staking contract and vault do for a wallet. Figures follow what the
 * visitor does: a stake raises the staked series and the feed, an epoch the mock's clock closes pays
 * the stakers its share, and a claim moves what the vault has paid.
 */

import { EngineError } from "../engine/client";
import type { ActivityPage, DistributionProof, MonkeyView, MonkeySeriesMetric, SeriesPage, SeriesQuery, SeriesResolution } from "../engine/stats-types";
import { fixedToWire, type Fixed } from "../fixed";
import { MONKEY_UNIT } from "../format";
import { mockHex } from "./client";
import { houseNav } from "./accounts";
import { COOLDOWN_MS, EPOCH_MS, FLOOR_USD, HALVING_PERIODS, PERIOD_BUDGET, PERIOD_MS } from "./monkey-state";
import type { MockState } from "./state";

const RESOLUTION_MS: Record<SeriesResolution, number> = { "1m": 60_000, "1h": 3_600_000, "1d": 86_400_000 };
const MAX_LIMIT = 2_000;
const UNITS: Record<MonkeySeriesMetric, string> = {
  total_staked: "monkey_base_units", total_allocated: "monkey_base_units", cumulative_distributed: "usdc_base_units",
  distributed_per_epoch: "usdc_base_units", monkey_per_loss: "monkey_base_units_per_usd",
};
/** The USDC the mock's vault had paid stakers before its history began. */
const DISTRIBUTED_BEFORE = 1_480_000n * 1_000_000n;

/** The mock node's stand-in contract addresses, shown where a live build would read its deployment. */
export function mockContracts(): { token: string; staking: string } {
  return { token: `0x${mockHex("monkey-token", 20)}`, staking: `0x${mockHex("staking", 20)}` };
}

/** The MONKEY a wallet holds: what it held before, plus what it claimed, less what it staked or has unstaking. */
export function walletBalance(state: MockState, address: string): bigint {
  const key = address.toLowerCase();
  const { monkey } = state;
  return (monkey.seededBalance.get(key) ?? 0n) + (state.claimedMonkey.get(key) ?? 0n) - (monkey.staked.get(key) ?? 0n) - (monkey.unstaking.get(key)?.amount ?? 0n);
}

function totalStaked(state: MockState): bigint {
  return state.monkey.totalStakedAt(state.now);
}

/** What a close would share: the lesser of the house's NAV and its cash, above the floor, as the engine's rule bounds it (unrealised client losses are in NAV but are not cash to pay out). */
function excessOf(state: MockState, nav: Fixed): Fixed {
  const available = nav < state.houseCash ? nav : state.houseCash;
  return available > FLOOR_USD ? available - FLOOR_USD : 0n;
}

/** `GET /v1/monkey`. */
export function overview(state: MockState): MonkeyView {
  const { monkey, now } = state;
  const period = monkey.periodAt(now);
  const epoch = Math.floor((now - monkey.startMs) / EPOCH_MS);
  const last = monkey.epochs[monkey.epochs.length - 1];
  const nextHalving = (Math.floor(period / HALVING_PERIODS) + 1) * HALVING_PERIODS;
  // What a close would distribute now: the house's NAV above the floor, as the engine's rule has it.
  const nav = houseNav(state);
  const excess = excessOf(state, nav);
  const allocated = monkey.allocatedAt(now);
  const maxSupply = 2n * BigInt(HALVING_PERIODS) * PERIOD_BUDGET;
  return {
    seq: state.seq, time_ms: now, begins_ms: monkey.begins, begins_seq: 0, from_genesis: true,
    emissions: {
      start_ms: monkey.startMs, period_ms: PERIOD_MS, period_budget: PERIOD_BUDGET.toString(), halving_periods: HALVING_PERIODS,
      period, current_budget: monkey.budget(period).toString(), next_halving_ms: monkey.startMs + nextHalving * PERIOD_MS,
      max_supply: maxSupply.toString(), allocated: allocated.toString(), cancelled: (maxSupply / 40n).toString(),
    },
    staking: { total_staked: totalStaked(state).toString(), stakers: monkey.stakerCount(), cooldown_ms: COOLDOWN_MS },
    distribution: {
      start_ms: monkey.startMs, epoch_ms: EPOCH_MS, liquidity_floor: fixedToWire(FLOOR_USD),
      nav: fixedToWire(nav), excess_usd: fixedToWire(excess), excess_seq: state.seq,
      epoch, last_closed_epoch: last?.epoch ?? null, last_closed_ms: last?.closedMs ?? null, next_close_ms: monkey.startMs + (epoch + 1) * EPOCH_MS,
      distributed_usdc_units: (DISTRIBUTED_BEFORE + monkey.epochs.reduce((sum, close) => sum + close.allocated, 0n)).toString(),
      last_distribution: last === undefined ? null : {
        epoch: last.epoch, closed_ms: last.closedMs, nav: fixedToWire(last.nav),
        floor: fixedToWire(FLOOR_USD), excess_usdc_units: last.allocated.toString(), allocated_usdc_units: last.allocated.toString(),
      },
    },
  };
}

/** `GET /v1/monkey/activity`: the newest events first, older than `before`. */
export function activityPage(state: MockState, params: { limit?: number; before?: string }): ActivityPage {
  const { monkey } = state;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const before = params.before === undefined ? Number.POSITIVE_INFINITY : Number(params.before);
  const older = monkey.activity.filter((entry) => entry.id < before).reverse();
  const page = older.slice(0, limit);
  const lastEntry = page[page.length - 1];
  return {
    entries: page.map((entry) => ({ id: String(entry.id), seq: entry.id, ts: entry.ts, type: entry.type, account: entry.account, amount: entry.amount.toString(), period: entry.period })),
    next: older.length > limit && lastEntry ? String(lastEntry.id) : null,
    begins_ms: monkey.begins, begins_seq: 0, from_genesis: true, truncated: false, retained_from_ms: null,
  };
}

/** `GET /v1/stats/series`, bucketed as the node buckets: oldest first, from `from_ms`, at most `limit`. */
export function monkeySeries(state: MockState, query: SeriesQuery & { metric: MonkeySeriesMetric }): SeriesPage {
  const { monkey, now } = state;
  const width = RESOLUTION_MS[query.resolution];
  const limit = Math.min(Math.max(query.limit ?? 500, 1), MAX_LIMIT);
  const first = Math.floor(Math.max(query.fromMs ?? monkey.begins, monkey.begins) / width) * width;
  const lastStart = Math.floor(Math.min(query.toMs ?? now, now) / width) * width;
  const entries: SeriesPage["entries"] = [];
  let next: number | null = null;
  const prefix = closedTotals(state);
  const level = (read: (ts: number) => bigint, ts: number): SeriesPage["entries"][number] => {
    const open = read(ts);
    const close = read(Math.min(ts + width - 1, now));
    return { ts, open: open.toString(), high: (open > close ? open : close).toString(), low: (open < close ? open : close).toString(), close: close.toString() };
  };
  for (let ts = first; ts <= lastStart; ts += width) {
    if (entries.length === limit) { next = ts; break; }
    const end = ts + width;
    if (query.metric === "total_staked") entries.push(level((at) => monkey.totalStakedAt(at), ts));
    else if (query.metric === "total_allocated") entries.push(level((at) => monkey.allocatedAt(at), ts));
    else if (query.metric === "cumulative_distributed") entries.push(level((at) => DISTRIBUTED_BEFORE + prefix.upTo(at), ts));
    else if (query.metric === "distributed_per_epoch") {
      const inside = monkey.epochs.filter((close) => close.closedMs >= ts && close.closedMs < end);
      if (inside.length > 0) entries.push({ ts, value: inside.reduce((sum, close) => sum + close.allocated, 0n).toString() });
    } else {
      const inside = monkey.periods.filter((close) => close.ts >= ts && close.ts < end);
      const weight = inside.reduce((sum, close) => sum + close.weight, 0n);
      // Base units per dollar with nine decimals, as the engine's ratio: amount * 10^18 / weight, the weight being dollars * 10^9.
      if (weight > 0n) entries.push({ ts, value: fixedToWire((inside.reduce((sum, close) => sum + close.amount, 0n) * 10n ** 18n) / weight) });
    }
  }
  return {
    metric: query.metric, market: null, resolution: query.resolution, kind: query.metric === "distributed_per_epoch" ? "flow" : query.metric === "monkey_per_loss" ? "ratio" : "level",
    unit: UNITS[query.metric], begins_ms: monkey.begins, begins_seq: 0, from_genesis: true, retained_from_ms: null, entries, next, max_limit: MAX_LIMIT,
  };
}

/** The distributions closed so far, as a running total looked up by time. */
function closedTotals(state: MockState): { upTo(ts: number): bigint } {
  const times: number[] = [];
  const totals: bigint[] = [];
  let running = 0n;
  for (const close of state.monkey.epochs) {
    running += close.allocated;
    times.push(close.closedMs);
    totals.push(running);
  }
  return {
    upTo(ts) {
      let low = 0;
      let high = times.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if ((times[mid] ?? 0) <= ts) low = mid + 1;
        else high = mid;
      }
      return low === 0 ? 0n : (totals[low - 1] ?? 0n);
    },
  };
}

/** `GET /v1/accounts/{address}/distributions`, against the simulated vault's latest posted checkpoint; a 404 when nothing was distributed to the account. */
export function distributionProof(state: MockState, address: string): DistributionProof {
  const entitled = state.monkey.distEntitled.get(address.toLowerCase());
  if (entitled === undefined) throw new EngineError(404, "not found");
  return { seq: state.postedSeq, root: `0x${mockHex("distribution-root", 32)}`, account: address, entitled: entitled.toString(), siblings: [] };
}

/** Closes every distribution epoch the clock has passed, paying each staker its share of the amount, and posts a checkpoint with the close. */
export function closeDistributionEpochs(state: MockState): void {
  const { monkey } = state;
  let closed = false;
  for (;;) {
    const epoch = (monkey.epochs[monkey.epochs.length - 1]?.epoch ?? Math.floor((monkey.seededAt - monkey.startMs) / EPOCH_MS) - 1) + 1;
    const closedMs = monkey.startMs + (epoch + 1) * EPOCH_MS;
    if (closedMs > state.now) break;
    // The close shares the house's NAV above the floor, in whole USDC, and takes it out of the house's cash, as the engine's does.
    const nav = houseNav(state);
    const allocated = excessOf(state, nav) / 1_000n;
    state.houseCash -= allocated * 1_000n;
    const total = monkey.totalStakedAt(closedMs);
    for (const account of new Set([...monkey.staked.keys(), ...monkey.unstaking.keys()])) {
      // An unstake still in its cooldown keeps earning, as the engine counts it staked until it completes.
      const held = (monkey.staked.get(account) ?? 0n) + (monkey.unstaking.get(account)?.amount ?? 0n);
      const share = total > 0n ? (allocated * held) / total : 0n;
      if (share > 0n) monkey.distEntitled.set(account, (monkey.distEntitled.get(account) ?? 0n) + share);
    }
    monkey.epochs.push({ epoch, closedMs, nav, allocated });
    closed = true;
  }
  if (closed) state.postedSeq = state.seq;
}

/** Records an emission period's loss allocation in the feed. */
export function noteLossClose(state: MockState, account: string, period: number, amount: bigint): void {
  state.monkey.record(state.now, "loss_close", account, amount, period);
}

/** Records a closed emission period's allocation and loss, which gives its MONKEY per dollar, and what it added to the total. */
export function notePeriodClose(state: MockState, endMs: number, amount: bigint, weight: bigint): void {
  state.monkey.periods.push({ ts: endMs, amount, weight });
  state.monkey.allocationSteps.push({ ts: endMs, delta: amount });
}

/** Stands in for the staking contract's `stake`: moves tokens from the wallet into the contract and records the event the engine mirrors. */
export function stake(state: MockState, address: string, amount: bigint): void {
  const key = address.toLowerCase();
  if (amount <= 0n) throw new Error("The amount must be more than zero.");
  if (walletBalance(state, key) < amount) throw new Error("Your wallet holds less MONKEY than that.");
  state.monkey.staked.set(key, (state.monkey.staked.get(key) ?? 0n) + amount);
  state.monkey.stakeSteps.push({ ts: state.now, delta: amount, account: key });
  state.monkey.record(state.now, "stake", key, amount);
}

/** Stands in for `startUnstake`: the amount stops being the contract's stake now and is returned once the cooldown passes, and keeps earning until then. */
export function startUnstake(state: MockState, address: string, amount: bigint): void {
  const key = address.toLowerCase();
  const staked = state.monkey.staked.get(key) ?? 0n;
  if (amount <= 0n || amount > staked) throw new Error("You have not staked that much MONKEY.");
  state.monkey.staked.set(key, staked - amount);
  const pending = state.monkey.unstaking.get(key);
  state.monkey.unstaking.set(key, { amount: (pending?.amount ?? 0n) + amount, claimableAt: state.now + COOLDOWN_MS });
}

/** Stands in for `completeUnstake`; the engine counts the tokens unstaked from here. */
export function completeUnstake(state: MockState, address: string): void {
  const key = address.toLowerCase();
  const pending = state.monkey.unstaking.get(key);
  if (pending === undefined) throw new Error("There is no unstake to complete.");
  if (state.now < pending.claimableAt) throw new Error("The cooldown has not passed yet.");
  state.monkey.unstaking.delete(key);
  state.monkey.stakeSteps.push({ ts: state.now, delta: -pending.amount, account: key });
  state.monkey.record(state.now, "unstake", key, pending.amount);
}

/** Stands in for the vault's `claimDistribution`: it pays what the cumulative distribution adds to what it paid. */
export function claimDistribution(state: MockState, address: string, entitled: bigint): void {
  const key = address.toLowerCase();
  const claimed = state.monkey.distClaimed.get(key) ?? 0n;
  if (entitled <= claimed) throw new Error("The simulated vault has already paid at least that much to this account.");
  state.monkey.distClaimed.set(key, entitled);
}

/** Gives the demo account something to see: MONKEY in its wallet, a stake, and a distribution waiting at the posted checkpoint. */
export function seedMonkeyDemo(state: MockState, address: string): void {
  const key = address.toLowerCase();
  state.monkey.seededBalance.set(key, 40_000n * MONKEY_UNIT);
  state.monkey.staked.set(key, 12_000n * MONKEY_UNIT);
  state.monkey.stakeSteps.push({ ts: state.monkey.begins, delta: 12_000n * MONKEY_UNIT, account: key });
  state.monkey.distEntitled.set(key, 37_250_000n);
}
