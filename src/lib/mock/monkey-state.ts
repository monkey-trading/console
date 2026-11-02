/**
 * What the mock node holds for the MONKEY page: the schedule, the stakers, the public activity, the
 * closed distribution epochs and the closed emission periods. The history before the mock's start is
 * generated from a seed, so every visitor sees the same page; what the visitor does and what the
 * mock's clock closes after it is recorded on top. `monkey.ts` serves these as the node's routes.
 */

import { fixedFromInt, type Fixed } from "../fixed";
import { MONKEY_UNIT } from "../format";
import { mulberry32, SEED } from "../prng";

export const DAY_MS = 86_400_000;
/** The engine's ten-minute emission periods and their halving cadence. */
export const PERIOD_MS = 600_000;
export const HALVING_PERIODS = 26_280;
/** Period 0's budget: the budget now, after one halving, is the 1,000 MONKEY the mock's own periods allocate. */
export const PERIOD_BUDGET = 2_000n * MONKEY_UNIT;
/** The mock's distribution epoch and unstake cooldown, short enough to watch; the cooldown covers an epoch as the contract requires. */
export const EPOCH_MS = 600_000;
export const COOLDOWN_MS = 1_800_000;
/** The house NAV at or below which nothing is distributed: 100,000 under the mock house's starting capital (`HOUSE_CAPITAL` in `state.ts`), so the first close shares that and later ones what the house has earned since. */
export const FLOOR_USD: Fixed = fixedFromInt(19_900_000);
/** How far back the generated history reaches, and the share of each period's budget that finds a loss to allocate. */
export const HISTORY_MS = 30 * DAY_MS;
const UTILISATION_PERCENT = 62n;
/** The tokens held by stakers other than the visitor's accounts: they grow over the history. */
const BASE_STAKED_START = 1_400_000n * MONKEY_UNIT;
const BASE_STAKED_GROWTH = 600_000n * MONKEY_UNIT;
const OTHER_STAKERS = 187;

export interface MockActivity {
  id: number;
  ts: number;
  type: "loss_close" | "stake" | "unstake";
  account: string;
  amount: bigint;
  period: number | null;
}

/** An emission period's allocation and the realised loss it was shared over, which gives MONKEY per dollar. */
export interface PeriodClose {
  ts: number;
  amount: bigint;
  weight: Fixed;
}

export interface EpochClose {
  epoch: number;
  closedMs: number;
  /** The house NAV the close measured. */
  nav: Fixed;
  /** USDC base units the close allocated to stakers; zero when NAV was at or below the floor. */
  allocated: bigint;
}

/** A change in a running total, for the series built from them. */
export interface Step {
  ts: number;
  delta: bigint;
}

/** A change to what one of the visitor's accounts holds in the staking contract. */
export interface StakeStep extends Step {
  account: string;
}

const hex = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

export class MockMonkey {
  /** Where the generated history, and so the node's record, begins. */
  readonly begins: number;
  /** When period 0 and epoch 0 start: far enough back that one halving falls inside the history. */
  readonly startMs: number;
  /** MONKEY base units staked in the contract, and an unstake waiting out its cooldown, per visitor account. */
  readonly staked = new Map<string, bigint>();
  readonly unstaking = new Map<string, { amount: bigint; claimableAt: number }>();
  /** MONKEY a wallet holds from before the mock started, on top of what it has claimed. */
  readonly seededBalance = new Map<string, bigint>();
  /** Cumulative USDC distributions with their proofs against the posted checkpoint, and what the vault has paid. */
  readonly distEntitled = new Map<string, bigint>();
  readonly distClaimed = new Map<string, bigint>();
  readonly activity: MockActivity[] = [];
  readonly epochs: EpochClose[] = [];
  readonly periods: PeriodClose[] = [];
  readonly stakeSteps: StakeStep[] = [];
  /** What the loss closes the mock's clock made since it started add to the allocated total. */
  readonly allocationSteps: Step[] = [];
  private nextId = 1;

  constructor(readonly seededAt: number) {
    this.begins = seededAt - HISTORY_MS;
    // 170 days before the history begins, so the first halving is 12.5 days into it.
    // Aligned to the ten-minute periods, so they close on the clock's own boundaries.
    this.startMs = Math.floor((this.begins - 170 * DAY_MS) / PERIOD_MS) * PERIOD_MS;
    this.seed();
  }

  /** Adds an event to the public feed, newest last. */
  record(ts: number, type: MockActivity["type"], account: string, amount: bigint, period: number | null = null): void {
    this.activity.push({ id: this.nextId++, ts, type, account, amount, period });
  }

  /** The period that holds `ts`, from period 0's start. */
  periodAt(ts: number): number {
    return Math.floor((ts - this.startMs) / PERIOD_MS);
  }

  /** The budget of `period` in MONKEY base units: period 0's, halved once per halving. */
  budget(period: number): bigint {
    return PERIOD_BUDGET >> BigInt(Math.floor(period / HALVING_PERIODS));
  }

  /** The total allocated by `ts`: the generated schedule up to where it was seeded, then exactly what the mock's own closes added. */
  allocatedAt(ts: number): bigint {
    const n = Math.min(Math.max(this.periodAt(ts), 0), this.periodAt(this.seededAt));
    const first = Math.min(n, HALVING_PERIODS);
    const second = Math.min(Math.max(n - HALVING_PERIODS, 0), HALVING_PERIODS);
    const base = ((PERIOD_BUDGET * BigInt(first) + (PERIOD_BUDGET / 2n) * BigInt(second)) * UTILISATION_PERCENT) / 100n;
    return base + sumUpTo(this.allocationSteps, ts);
  }

  /** The tokens other stakers hold at `ts`, growing across the history. */
  otherStakedAt(ts: number): bigint {
    const through = BigInt(Math.min(Math.max(ts - this.begins, 0), HISTORY_MS * 2));
    return BASE_STAKED_START + (BASE_STAKED_GROWTH * through) / BigInt(HISTORY_MS);
  }

  /** The total the engine counts as staked at `ts`: the others' and the visitor accounts', unstakes in their cooldown included. */
  totalStakedAt(ts: number): bigint {
    return this.otherStakedAt(ts) + sumUpTo(this.stakeSteps, ts);
  }

  /** Forgets everything the account holds in the staking contract and the vault, as if it had never staked. */
  forget(account: string): void {
    this.staked.delete(account);
    this.unstaking.delete(account);
    this.seededBalance.delete(account);
    this.distEntitled.delete(account);
    this.distClaimed.delete(account);
    const kept = this.stakeSteps.filter((step) => step.account !== account);
    this.stakeSteps.splice(0, this.stakeSteps.length, ...kept);
  }

  stakerCount(): number {
    return OTHER_STAKERS + this.staked.size;
  }

  /** What an epoch's close distributes, in USDC base units: none every seventh epoch, as when NAV sits at the floor. */
  excessOf(epoch: number): bigint {
    if (epoch % 7 === 0) return 0n;
    const draw = mulberry32(SEED + epoch)();
    return BigInt(Math.floor(400 + draw * 1_000)) * 1_000_000n;
  }

  private seed(): void {
    const rand = mulberry32(SEED + 104);
    // Closed emission periods: each shares its whole budget over the losses realised in it.
    const firstPeriod = this.periodAt(this.begins);
    for (let period = firstPeriod; period < this.periodAt(this.seededAt); period += 1) {
      const weight = fixedFromInt(80) + BigInt(Math.floor(rand() * 140 * 1e9));
      this.periods.push({ ts: this.startMs + (period + 1) * PERIOD_MS, amount: this.budget(period), weight });
    }
    // Closed distribution epochs.
    const firstEpoch = Math.floor((this.begins - this.startMs) / EPOCH_MS);
    const lastEpoch = Math.floor((this.seededAt - this.startMs) / EPOCH_MS);
    for (let epoch = firstEpoch; epoch < lastEpoch; epoch += 1) {
      const allocated = this.excessOf(epoch);
      this.epochs.push({ epoch, closedMs: this.startMs + (epoch + 1) * EPOCH_MS, nav: FLOOR_USD + allocated * 1_000n, allocated });
    }
    // A feed of the last two days: losses closing each period, and stakers coming and going.
    const feedFrom = this.seededAt - 2 * DAY_MS;
    for (let ts = feedFrom; ts < this.seededAt; ts += 7 * 60_000 + Math.floor(rand() * 9 * 60_000)) {
      const account = hex(0x1000 + Math.floor(rand() * 40));
      const draw = rand();
      const type = draw < 0.7 ? "loss_close" : draw < 0.9 ? "stake" : "unstake";
      const amount = BigInt(Math.floor(5 + rand() * 600)) * MONKEY_UNIT + BigInt(Math.floor(rand() * 100)) * (MONKEY_UNIT / 100n);
      this.record(ts, type, account, amount, type === "loss_close" ? this.periodAt(ts) : null);
    }
  }
}

/** The sum of the deltas recorded at or before `ts`. */
function sumUpTo(steps: readonly Step[], ts: number): bigint {
  let sum = 0n;
  for (const step of steps) if (step.ts <= ts) sum += step.delta;
  return sum;
}
