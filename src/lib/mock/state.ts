/** The mock node's state: markets, accounts, the vault's queue, and the log it streams. */

import { fixedFromInt, type Fixed } from "../fixed";
import type { HouseParams } from "../house";
import { mulberry32, SEED } from "../prng";
import type {
  EligibilityClass,
  EngineCommand,
  EngineEvent,
  MarketId,
  OrderId,
  RestingOrder,
  StreamMessage,
} from "../engine/types";
import { MARKETS, type ListedMarket } from "./markets";
import { EMISSION_PERIOD_MS } from "./emissions";
import { isOpen } from "../schedule";

/** Where the node's real-peer screening places the caller. */
export type Region = "allowed" | "united_states" | "sanctioned_jurisdiction";

export interface MarketRuntime {
  listed: ListedMarket;
  mid: Fixed;
  open: boolean;
  stress: number;
  /** The operator's stress floor; the effective level is the higher of this and the automatic one. */
  floor: number;
  reduceOnly: boolean;
  /** An operator closure on top of the schedule. */
  halted: boolean;
  /** Recent mids with their stamps, for the stress window. */
  window: { t: number; mid: Fixed }[];
  rand: () => number;
  /** A one-off move to apply at the next step, in basis points. */
  shockBps: number;
}

export interface Holding {
  qty: Fixed;
  entry: Fixed;
}

export interface PendingDeposit {
  amount: Fixed;
  readyAt: number;
}

export interface AccountState {
  balance: Fixed;
  pending: PendingDeposit[];
  positions: Map<MarketId, Holding>;
  orders: Map<OrderId, RestingOrder>;
  nextNonce: number;
  /** The last withdrawal approval nonce issued: one counter per account, starting at 1, never reused. */
  approvalNonce: number;
  eligibility: EligibilityClass | null;
}

export interface QueueEntry {
  account: string;
  amount: Fixed;
  remaining: Fixed;
  requestedSeq: number;
}

/** A session key registered for an account, as the engine's V41 rules hold it: live until `expiresAt`, dead once revoked. Its request-nonce sequence lives apart in `MockState.sessionKeyNonces`, so it stays spent whatever the registration does, as the engine's `request_nonces` does. */
export interface MockSessionKey {
  expiresAt: number;
  revoked: boolean;
}

/** An event with its cursor: the command's seq and the event's index among that command's events. */
export interface HistoryItem {
  cursor: string;
  seq: number;
  index: number;
  ts: number;
  event: EngineEvent;
}

export type Listener = (message: StreamMessage) => void;

/** The house's starting capital, in dollars. */
export const HOUSE_CAPITAL = fixedFromInt(20_000_000);
/** How long a deposit is unfinalised before the node credits it, in milliseconds. */
export const FINALITY_MS = 6_000;
/**
 * The mock's checkpoint cadence: one checkpoint per this many sequenced commands, mirroring the
 * node's `checkpoint_every`. The mock compresses days into seconds, so the cadence is compressed
 * too; the engine's own is its config's.
 */
export const CHECKPOINT_EVERY = 50;
const LOG_LIMIT = 1_000;

/** The launch solvency parameters the mock mirrors from the engine's dev genesis (`config/dev.toml`). */
const LAUNCH_PARAMS: HouseParams = {
  profitFeeBps: 1000,
  closeoutLevelBps: 5000,
  totalCapBps: 20000,
  totalCapFloor: fixedFromInt(2_000_000),
  seq: null,
  fresh: "current",
};

export class MockState {
  now: number;
  seq = 0;
  nextOrderId = 1;
  region: Region = "allowed";
  /** While set, `advance` publishes no `prices` commands: the demo backstory keeps the log to what happened. */
  quietPrices = false;
  houseCash: Fixed = HOUSE_CAPITAL;
  vaultLiquidity: Fixed = 0n;
  /** The solvency parameters in force; the mock changes none, as the operator's key signs none here. */
  readonly params: HouseParams = LAUNCH_PARAMS;
  readonly markets = new Map<MarketId, MarketRuntime>();
  readonly accounts = new Map<string, AccountState>();
  /** Every account's session keys by lowercase address, as `engine_core::session_keys` holds them. */
  readonly sessionKeys = new Map<string, Map<string, MockSessionKey>>();
  /** Every session key's next request nonce, spent for good as the engine's `request_nonces` holds it. */
  readonly sessionKeyNonces = new Map<string, number>();
  readonly queue: QueueEntry[] = [];
  readonly log: StreamMessage[] = [];
  readonly history = new Map<string, HistoryItem[]>();
  readonly listeners = new Set<Listener>();
  /**
   * MONKEY emissions, as the engine and the vault hold them: the open period's per-account net
   * realised results, each account's cumulative entitlement in base units, what the simulated
   * vault has minted (`emissionsClaimed`), and the seq of the vault's latest posted checkpoint,
   * which the mock's entitlement proofs are taken against.
   */
  emission: { period: number; results: Map<string, { address: string; realised: Fixed; writtenOff: Fixed }> };
  readonly entitledMonkey = new Map<string, bigint>();
  readonly claimedMonkey = new Map<string, bigint>();
  postedSeq = 0;

  /** Starts at `startMs` with every market at its starting index; open per its schedule. */
  constructor(startMs: number) {
    this.now = startMs;
    this.emission = { period: Math.floor(startMs / EMISSION_PERIOD_MS), results: new Map() };
    for (const listed of MARKETS) {
      this.markets.set(listed.spec.id, {
        listed,
        mid: listed.sim.start,
        open: isOpen(listed.spec.schedule, startMs),
        stress: 0,
        floor: 0,
        reduceOnly: false,
        halted: false,
        window: [{ t: startMs, mid: listed.sim.start }],
        rand: mulberry32(SEED + listed.spec.id),
        shockBps: 0,
      });
    }
  }

  /** The account's state, created empty on first reference. */
  account(address: string): AccountState {
    const key = address.toLowerCase();
    let state = this.accounts.get(key);
    if (!state) {
      state = { balance: 0n, pending: [], positions: new Map(), orders: new Map(), nextNonce: 0, approvalNonce: 0, eligibility: null };
      this.accounts.set(key, state);
    }
    return state;
  }

  /**
   * Sequences one command with its events: stamps it, appends it to the log, indexes the events
   * that name an account, and delivers it to every subscriber.
   */
  emit(cmd: EngineCommand, events: EngineEvent[]): StreamMessage {
    this.seq += 1;
    const message: StreamMessage = { offset: `${this.seq}:0`, type: "command", seq: this.seq, ts: this.now, cmd, events };
    this.log.push(message);
    if (this.log.length > LOG_LIMIT) this.log.shift();
    events.forEach((event, index) => {
      if ("account" in event) {
        const key = event.account.toLowerCase();
        const items = this.history.get(key) ?? [];
        items.push({ cursor: `${message.seq}:${index}`, seq: message.seq, index, ts: this.now, event });
        this.history.set(key, items);
      }
    });
    for (const listener of this.listeners) listener(message);
    return message;
  }
}
