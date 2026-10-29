/** The console's state: what the screens read, replaced whole on every change. */

import { DEFAULT_TIMEFRAME, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { SignatureChecks } from "../engine/client";
import type { HistoryEvent, MarketId, MarketQuote, MarketView, HouseView, QueuedWithdrawal, SignedWithdrawal } from "../engine/types";
import { fixedToNumber } from "../fixed";
import { decodeHouse, decodeMarket, type AccountModel, type Eligibility, type HouseModel, type MarketModel } from "../models";

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

/** Where a payout's newest authorization lies when the page has not seen it. */
export interface PayoutHint {
  /** The log head when the node took a reissue request, past which the new authorization lands. */
  searchFrom?: number;
  /** The expiry (Unix seconds) of an authorization the node says it signed, newer than any the page holds. */
  newerUntil?: number;
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
  timeframe: TimeframeId;
  selected: MarketId;
  house: HouseModel;
  wallet: { address: string; label: string } | null;
  eligibility: Eligibility;
  account: AccountModel | null;
  queue: QueuedWithdrawal[];
  history: HistoryEntry[];
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
  /** What the page knows of a payout's authorizations beyond the one it holds, by payout nonce. */
  payoutHints: Record<number, PayoutHint>;
  /** The payout nonce whose authorization the log is being searched for. */
  searching: number | null;
  /** The connected account's payout nonces the vault has paid, as its wallet's chain reads them. */
  paid: number[];
  /** What the wallet is asked to sign or send now, shown while it waits for the user. */
  prompt: string | null;
  /** Whether a signed action is in flight. */
  busy: boolean;
  /** Whether the funding drawer is open. */
  fundingOpen: boolean;
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

/** The state before anything has loaded, from the first `GET /v1/markets` and `/v1/house`. */
export function initialState(markets: MarketView[], house: HouseView, startMs: number, history: HistorySource, signatures: SignatureChecks): ConsoleState {
  const models = markets.map((view) => decodeMarket(view, undefined, signatures === "none"));
  return {
    now: startMs,
    attestation: { kind: "checking" },
    stream: signatures === "none" ? "live" : "connecting",
    signatures,
    blocked: null,
    markets: models,
    bars: seedAllBars(models, startMs, history),
    timeframe: DEFAULT_TIMEFRAME,
    selected: models[0]?.id ?? 1,
    house: decodeHouse(house),
    wallet: null,
    eligibility: null,
    account: null,
    queue: [],
    history: [],
    feed: [],
    toasts: [],
    quotes: {},
    quoteError: null,
    quoted: [],
    authorizations: [],
    approvals: [],
    approvalsNext: null,
    payoutHints: {},
    searching: null,
    paid: [],
    prompt: null,
    busy: false,
    fundingOpen: false,
    paused: false,
  };
}
