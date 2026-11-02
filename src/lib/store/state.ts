/** The console's state: what the screens read, replaced whole on every change. */

import { DEFAULT_TIMEFRAME, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { SignatureChecks } from "../engine/client";
import type { EntitlementProof } from "../engine/emissions";
import type { HistoryEvent, HouseView, QueuedWithdrawal, SignedWithdrawal, MarketId, MarketQuote, MarketView } from "../engine/types";
import type { CheckpointEntry } from "../engine/wire";
import type { HouseParams, QueueTotals } from "../house";
import type { MarkProvenance } from "../engine/mark-types";
import { fixedToNumber } from "../fixed";
import { decodeHouse, decodeMarket, type AccountModel, type Eligibility, type HouseModel, type MarketModel } from "../models";
import type { HousePanelInit } from "./store-deps";
import { emptyLedgerState, type LedgerState } from "./ledger";

export type BlockReason = "united_states" | "sanctioned_jurisdiction";

export interface ToastMessage {
  id: number;
  tone: "ok" | "error" | "info";
  text: string;
}

export interface FeedLine {
  id: number;
  ts: number;
  text: string;
  /** The account the line is about, when it is about one. */
  account?: string;
}

export type HistoryEntry = HistoryEvent;

/** What the node's last complete, loaded list of the account's unpaid approvals covered. */
export interface PayoutsRead {
  /** The last sequenced command the list reflects: an approval at or before it, and not listed, is paid. */
  seq: number;
  /** The nonces of the unpaid approvals the list held. */
  listed: number[];
}

export interface ConsoleState {
  /** The node's clock: the stamp of the latest message. */
  now: number;
  attestation: AttestationStatus;
  /** Whether the node's stream is arriving; order entry waits while it is stale. */
  stream: FeedStatus;
  /** Whether the client checks the node's signatures; `none` is the in-browser mock. */
  signatures: SignatureChecks;
  /** Set when the node refuses the caller's region. */
  blocked: BlockReason | null;
  markets: MarketModel[];
  /** Bars per market and timeframe, built from the node's marks. */
  bars: Record<MarketId, Record<TimeframeId, Bar[]>>;
  /**
   * Where a seeded series came from, per market and timeframe: `seeded_from_provider` is provider
   * history the node fetched for day one, `log_derived` history the node derived from its log.
   * Absent while a series is only the stream's own ticks; the chart shows both the same today.
   */
  barProvenance: Record<MarketId, Partial<Record<TimeframeId, MarkProvenance>>>;
  timeframe: TimeframeId;
  selected: MarketId;
  house: HouseModel;
  /** Whether a verified house answer has been read; false for a live node before its first read, so no placeholder renders as a figure. */
  houseReady: boolean;
  /** Whether the markets and house figures come from a current read; false after a failed refresh, so retained figures say they may be behind. */
  houseFresh: boolean;
  /** The latest `set_params` the node's log records, from its house state; null before one is set or read. */
  houseParams: HouseParams | null;
  /** The latest checkpoint the node's log holds; null before one is posted or read. */
  checkpoint: CheckpointEntry | null;
  /** Whether the parameters and checkpoint have been read: `unavailable` from a node that predates the route that serves them. */
  houseStateStatus: "pending" | "read" | "unavailable";
  /** The public FIFO withdrawal queue's size; null before the first read. */
  withdrawalTotals: QueueTotals | null;
  /** Whether the queue read failed; true between a failed walk and its recovery. */
  queueFailed: boolean;
  wallet: { address: string; label: string; readOnly?: boolean } | null;
  eligibility: Eligibility;
  account: AccountModel | null;
  queue: QueuedWithdrawal[];
  /** Whether the connected account's queue has been read since it connected; `queue` is empty before it, and after a read that failed. */
  accountQueueRead: boolean;
  history: HistoryEntry[];
  /** The P&L tab's rows and the schedule that prices them; read only once that tab has opened. */
  ledger: LedgerState;
  feed: FeedLine[];
  toasts: ToastMessage[];
  /** The node's executable quotes for the connected account, by market; the mock streams none and the ticket estimates. */
  quotes: Record<MarketId, MarketQuote>;
  /** Why the node will not quote the connected account, such as an account it has not credited yet. */
  quoteError: string | null;
  /** The markets the console asks the node to quote now; a quote for any other is not current. */
  quoted: MarketId[];
  /** Signed withdrawal authorizations for the connected account, the latest per payout nonce. */
  authorizations: SignedWithdrawal[];
  /** The connected account's approved withdrawals, newest first, read apart from its recent history so none drops out of reach. */
  approvals: HistoryEvent[];
  /** The cursor of the next page of older approvals, when the reads so far stopped short of them. */
  approvalsNext: string | null;
  /** The node's latest complete list of the account's unpaid approvals; null until a read of it finished loaded. */
  payoutsRead: PayoutsRead | null;
  /** Why the last read of the node's payouts did not finish, written for the user; null when it did or the node has no such route. */
  payoutsProblem: string | null;
  /** Counts reads of the node's payouts, so an answer a later read has overtaken is dropped. */
  payoutsGeneration: number;
  /** Counts reads of the approvals, so an answer a later read has overtaken is dropped. */
  approvalsGeneration: number;
  /** The connected account's payout nonces the vault has paid, as its wallet's chain reads them. */
  paid: number[];
  /** The payout nonces the vault had not paid when last read. */
  unpaid: number[];
  /** The connected account's cumulative MONKEY entitlement with its proof, against the node's last posted root. */
  entitlement: EntitlementProof | null;
  /** The vault's record of the connected account's MONKEY: what it has minted and its latest posted checkpoint seq. */
  emissionsVault: { claimed: bigint; latestSeq: number } | null;
  /** What the wallet is asked to sign or send now, shown while it waits for the user. */
  prompt: string | null;
  /** Whether a signed action is in flight. */
  busy: boolean;
  /** Whether the simulation is paused: the node clock and every price stand still. */
  paused: boolean;
}

/** Where the bars of a market and timeframe come from: history ending at the current mark. */
export type HistorySource = (symbol: string, seconds: number, endMs: number, endPrice: number) => Bar[];

/** Bars for every market and timeframe, ending at each market's mark. */
export function seedAllBars(markets: readonly MarketModel[], startMs: number, history: HistorySource): ConsoleState["bars"] {
  const out: ConsoleState["bars"] = {};
  for (const m of markets) {
    const price = m.mark === null ? 1 : fixedToNumber(m.mark);
    // Filled for every timeframe in the loop below before it is read.
    const perFrame = {} as Record<TimeframeId, Bar[]>;
    for (const tf of TIMEFRAMES) perFrame[tf.id] = history(m.symbol, tf.seconds, startMs, price);
    out[m.id] = perFrame;
  }
  return out;
}

/** The state before anything has loaded, from the first `GET /v1/markets` and `/v1/house`; `housePanel` seeds the House page's state where the session read it synchronously (the mock). */
export function initialState(markets: MarketView[], house: HouseView, startMs: number, history: HistorySource, signatures: SignatureChecks, housePanel?: HousePanelInit): ConsoleState {
  const models = markets.map((view) => decodeMarket(view, undefined, signatures === "none"));
  return {
    now: startMs,
    // A mock build always accepts the mock's own quote, so the session starts attested; a live
    // node starts unchecked, and nothing renders until its check passes.
    attestation: signatures === "none" ? { kind: "mock" } : { kind: "checking" },
    stream: signatures === "none" ? "live" : "connecting",
    signatures,
    blocked: null,
    markets: models,
    bars: seedAllBars(models, startMs, history),
    barProvenance: {},
    timeframe: DEFAULT_TIMEFRAME,
    selected: models[0]?.id ?? 1,
    house: decodeHouse(house),
    houseReady: signatures === "none",
    houseFresh: true,
    houseParams: housePanel?.params ?? null,
    checkpoint: housePanel?.checkpoint ?? null,
    houseStateStatus: signatures === "none" ? "read" : "pending",
    withdrawalTotals: housePanel?.totals ?? null,
    queueFailed: false,
    wallet: null,
    eligibility: null,
    account: null,
    queue: [],
    accountQueueRead: false,
    history: [],
    ledger: emptyLedgerState(),
    feed: [],
    toasts: [],
    quotes: {},
    quoteError: null,
    quoted: [],
    authorizations: [],
    approvals: [],
    approvalsNext: null,
    payoutsRead: null,
    payoutsProblem: null,
    payoutsGeneration: 0,
    approvalsGeneration: 0,
    paid: [],
    unpaid: [],
    entitlement: null,
    emissionsVault: null,
    prompt: null,
    busy: false,
    paused: false,
  };
}
