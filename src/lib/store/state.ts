/** The console's state: what the screens read, replaced whole on every change. */

import { DEFAULT_TIMEFRAME, TIMEFRAMES, type Bar, type TimeframeId } from "../bars";
import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { SignatureChecks } from "../engine/client";
import type { EntitlementProof } from "../engine/emissions";
import type { HistoryEvent, HouseView, ListingNotices, QueuedWithdrawal, Reject, SignedWithdrawal, MarketId, MarketQuote, MarketView } from "../engine/types";
import type { CheckpointEntry } from "../engine/wire";
import type { HouseParams, QueueTotals } from "../house";
import type { MarkProvenance } from "../engine/mark-types";
import { fixedToNumber, type Fixed } from "../fixed";
import { decodeHouse, decodeMarket, type AccountModel, type Eligibility, type HouseModel, type MarketModel } from "../models";
import { NO_EXIT, type ExitState } from "./exit-state";
import type { HousePanelInit } from "./store-deps";
import { emptyLedgerState, type LedgerState } from "./ledger";

export type BlockReason = "united_states" | "sanctioned_jurisdiction";

/** Where a message shows: beside the control the trader used, or in the one place its subject has on the page. */
export const NOTICE_SURFACES = [
  "ticket", "orders", "positions", "accountRead", "account", "deposit", "withdraw", "faucet", "setup", "payouts", "payoutReads", "payoutVault",
  "emissions", "distribution", "stake", "operator", "governance", "settings", "wallet", "node", "feed", "chart", "exit",
] as const;
export type NoticeSurface = (typeof NOTICE_SURFACES)[number];

/** One message on a surface. A failure is `error` and read out as an alert; `info` is a status. `id` tells a repeat of the same text from the message already there. */
export interface Notice {
  id: number;
  tone: "error" | "info";
  text: string;
}

export type Notices = Partial<Record<NoticeSurface, Notice>>;

/** The surfaces that outlive a change of wallet: they are about the node, the feed, the chart, or how the last wallet's connection ended. */
export const KEPT_ON_WALLET_CHANGE: readonly NoticeSurface[] = ["wallet", "node", "feed", "chart"];

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

/** Where the setup popup stands on this connection (monkey-trading/console#168, #199). */
export interface SetupState {
  /** Whether the popup is open; a dismissal lasts until something a missing step blocks reopens it. */
  open: boolean;
  /** Whether this connection's first account read has decided the popup. */
  decided: boolean;
  /** How the faucet step ended on this connection, or null while it has not. */
  fund: "minted" | "skipped" | null;
  /** The deposit this connection's wallet sent, with the account's balance before it, so the step knows when the node has credited it; null before one. */
  deposit: { amount: Fixed; balanceBefore: Fixed } | null;
}

/** A deposit the wallet sent to the vault that the node has not credited yet: `id` is the vault's, null until the chain has been read for it. */
export interface PendingDeposit {
  id: string | null;
  amount: Fixed;
}

/** A connection before anything has been read for it. */
export const NO_SETUP: SetupState = { open: false, decided: false, fund: null, deposit: null };

/** What the last read of the wallet's USDC found: its balance, the chain it sits on instead, or that the read failed. */
export type UsdcRead = { status: "unread" } | { status: "held"; amount: Fixed } | { status: "wrong_chain"; chainId: number } | { status: "failed" };

/** The wallet's USDC read; `phase` is `again` when a read was asked for while one ran, whose answer may predate the change. */
export interface WalletUsdc {
  read: UsdcRead;
  phase: "idle" | "reading" | "again";
}

/** No wallet read yet. */
export const NO_USDC: WalletUsdc = { read: { status: "unread" }, phase: "idle" };

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
  /** Whether the node has answered the access check; a visitor it refuses is never shown setup first. */
  accessChecked: boolean;
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
  /** Each listed market's pending listing notice, from the node's house state; empty before a read and while none waits. */
  listingNotices: ListingNotices;
  /** Whether the house state held has caught up with every change to it the stream carried, so a position's fee may be run from its curve; false before the first read. */
  pricingCurrent: boolean;
  /** Whether the parameters and checkpoint have been read: `unavailable` from a node that predates the route that serves them, `failed` when the first read did not land. */
  houseStateStatus: "pending" | "read" | "unavailable" | "failed";
  /** The public FIFO withdrawal queue's size; null before the first read. */
  withdrawalTotals: QueueTotals | null;
  /** Whether the queue read failed; true between a failed walk and its recovery. */
  queueFailed: boolean;
  wallet: { address: string; label: string; readOnly?: boolean } | null;
  /**
   * Whether the page load has settled its wallet: the mock's demo account, the URL's watched account,
   * or a stored connection choice has connected or failed. Until then no wallet means "not yet", not
   * "none", so a card holds the shape it will take rather than the line it shows with no wallet.
   */
  walletDecided: boolean;
  /** The chain the connected wallet says it moved to, when that is not the deployment's; null on the deployment's chain. Its requests wait until it is back (monkey-trading/console#289). */
  walletChain: number | null;
  eligibility: Eligibility;
  account: AccountModel | null;
  queue: QueuedWithdrawal[];
  /** Whether the connected account's eligibility, queue and state have been read since it connected; each is empty before it, and after a read that failed. */
  accountRead: boolean;
  /** How the connected account's first read of its history went: `history` is known to hold what the node holds only once it is `read`, and it stays so while later reads fail. */
  accountHistory: "waiting" | "read" | "failed";
  /** When this browser's session key expires by the node's clock, or 0 with no registered key; the key itself never enters the snapshot. */
  sessionExpiresAt: number;
  /** Why the last registration the node answered was refused, or null: orders and cancels then ask the wallet instead. */
  sessionRefusal: Reject | null;
  setup: SetupState;
  /** The deposits to the connected account that the node has not credited, from the wallet's send and, after a reload, from the vault's own events. */
  pendingDeposits: PendingDeposit[];
  /** The connected wallet's USDC on the custody chain, as its own provider reports it; never a node figure. */
  walletUsdc: WalletUsdc;
  history: HistoryEntry[];
  /** The P&L tab's rows and the schedule that prices them; read only once that tab has opened. */
  ledger: LedgerState;
  feed: FeedLine[];
  /** The messages on screen, one per surface, each replaced by the next action on its control and never timed out. */
  notices: Notices;
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
  /** The account's exit proof and where the vault's exit stands. */
  exit: ExitState;
  /** What the wallet is asked to sign or send now, shown while it waits for the user. */
  prompt: string | null;
  /** The surface that asked, where the prompt shows. */
  promptAt: NoticeSurface | null;
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
    accessChecked: false,
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
    listingNotices: {},
    // A mock session's first state carries the house state it holds.
    pricingCurrent: housePanel !== undefined,
    houseStateStatus: signatures === "none" ? "read" : "pending",
    withdrawalTotals: housePanel?.totals ?? null,
    queueFailed: false,
    wallet: null,
    walletDecided: false,
    walletChain: null,
    eligibility: null,
    account: null,
    queue: [],
    accountRead: false,
    accountHistory: "waiting",
    sessionExpiresAt: 0,
    sessionRefusal: null,
    setup: NO_SETUP,
    pendingDeposits: [],
    walletUsdc: NO_USDC,
    history: [],
    ledger: emptyLedgerState(),
    feed: [],
    notices: {},
    quotes: {},
    quoteError: null,
    quoted: [],
    exit: NO_EXIT,
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
    promptAt: null,
    busy: false,
    paused: false,
  };
}
