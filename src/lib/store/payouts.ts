/**
 * The connected account's approved withdrawals as payouts to claim on the vault: each approval's
 * signed authorization (from the node's list of unpaid approvals and from the stream), whether the
 * vault has paid it, the claim, and the request for a fresh authorization once it expired.
 */

import { EngineError } from "../engine/client";
import { reissueTypedData } from "../engine/eip712";
import type { HistoryEvent, PayoutEntry, SignedWithdrawal } from "../engine/types";
import { fixedFromWire, type Fixed } from "../fixed";
import { formatUsdc } from "../vault";
import { domainOf, errorText, prompting, usableWallet } from "./signing";
import { formatStamp } from "../time";
import { authorizationFor, keepLatest } from "./funds";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

/** The most approvals one read of the account's history returns: the node's page limit. */
const APPROVALS_LIMIT = 200;
/** The most pages of approvals read, so a node that keeps answering with more cannot keep the page reading. */
const APPROVAL_PAGES = 20;
/** The most unpaid approvals one read of the node's payouts returns: the node's page limit. */
const PAYOUTS_LIMIT = 200;
/** The most pages of payouts read, so a node that keeps answering with more cannot keep the page reading. */
const PAYOUT_PAGES = 20;
/** What a row says a failed read will do next: reads happen on triggers, never on a timer. */
const READ_AGAIN = "It is read again when the next withdrawal is approved or the page reloads.";
/** Paid payouts shown beside the unpaid ones, newest first. */
const PAID_SHOWN = 5;

/** Where one approved payout stands. */
export type PayoutStatus =
  | { kind: "paid" }
  /** Signed and claimable on the vault until `expiresAt` (Unix seconds). */
  | { kind: "claimable"; withdrawal: SignedWithdrawal; expiresAt: number }
  /** Its last authorization expired unclaimed, at `expiresAt`; a fresh one can be asked for. */
  | { kind: "expired"; expiresAt: number }
  /** Not signed yet: a checkpoint covering the approval comes first, and the stream then delivers the authorization. */
  | { kind: "waiting" };

export interface Payout {
  nonce: number;
  amount: Fixed;
  status: PayoutStatus;
  /** Whether the vault's record of the payout has been read, so an unpaid status is known rather than assumed. */
  read: boolean;
}

/**
 * Whether the node's list shows the approval paid: it is at or before the last command the complete,
 * loaded list reflects, and the list does not hold it. An approval after that command, or one whose
 * seq is unknown, is not settled by the list.
 */
function paidByNode(state: ConsoleState, nonce: number, approvedSeq: number | undefined): boolean {
  const read = state.payoutsRead;
  return read !== null && approvedSeq !== undefined && approvedSeq <= read.seq && !read.listed.includes(nonce);
}

/** Where payout `nonce`, approved at `approvedSeq`, stands at node time `nowSeconds`. */
function statusOf(state: ConsoleState, nonce: number, approvedSeq: number, nowSeconds: number): PayoutStatus {
  if (state.paid.includes(nonce) || paidByNode(state, nonce, approvedSeq)) return { kind: "paid" };
  const signed = authorizationFor(state, nonce);
  const held = signed?.authorization?.expires_at ?? 0;
  if (signed === null || held === 0) return { kind: "waiting" };
  return held > nowSeconds ? { kind: "claimable", withdrawal: signed, expiresAt: held } : { kind: "expired", expiresAt: held };
}

/** The approvals the page lists, newest first: the recent history has the newest even when the separate read of them failed or lags. */
function approvalsListed(state: ConsoleState): HistoryEvent[] {
  const recent = state.history.filter((e) => e.type === "withdrawal_approved" && !state.approvals.some((a) => a.type === "withdrawal_approved" && a.nonce === e.nonce));
  return [...recent, ...state.approvals];
}

/** Every unpaid payout of the account's approvals and recent history, newest first, then its newest paid ones, with where each stands at node time. */
export function payoutsOf(state: ConsoleState): Payout[] {
  const nowSeconds = Math.floor(state.now / 1000);
  const all = approvalsListed(state).flatMap((event) => {
    if (event.type !== "withdrawal_approved") return [];
    const approvedSeq = Number(event.cursor.split(":")[0]);
    const status = statusOf(state, event.nonce, approvedSeq, nowSeconds);
    return [{ nonce: event.nonce, amount: fixedFromWire(event.amount), status, read: status.kind === "paid" || state.unpaid.includes(event.nonce) }];
  });
  return [...all.filter((p) => p.status.kind !== "paid"), ...all.filter((p) => p.status.kind === "paid").slice(0, PAID_SHOWN)];
}

/**
 * Reads the connected account's approved withdrawals from its history, apart from the recent events,
 * page by page up to a budget; `older` reads on from where the last read stopped.
 */
export async function loadApprovals(store: ConsoleStore, older = false): Promise<void> {
  const address = store.getSnapshot().wallet?.address;
  if (address === undefined) return;
  const generation = store.getSnapshot().approvalsGeneration + 1;
  store.patch({ approvalsGeneration: generation });
  try {
    const approvals = older ? [...store.getSnapshot().approvals] : [];
    let before = older ? (store.getSnapshot().approvalsNext ?? undefined) : undefined;
    let next: string | null = null;
    for (let page = 0; page < APPROVAL_PAGES; page++) {
      const read = await store.deps.client.history(address, { kind: "withdrawal_approved", limit: APPROVALS_LIMIT, ...(before === undefined ? {} : { before }) });
      approvals.push(...read.events);
      next = read.next;
      if (next === null) break;
      before = next;
    }
    const state = store.getSnapshot();
    // A read started later answers for the account as it is now; this one's answer is older.
    if (state.wallet?.address === address && state.approvalsGeneration === generation) store.patch({ approvals, approvalsNext: next });
  } catch (error) {
    store.toast("error", `Your approved withdrawals could not be read: ${errorText(error)}`);
  }
}

/**
 * Reads the node's unpaid approvals of the connected account, page by page, and takes each
 * authorization from the answer. An answer for a wallet or a read that a later one overtook is
 * dropped. A nonce is paid only once a complete, loaded answer omits it: a failed or partial read
 * settles nothing, and a node that predates the route (404) leaves every row waiting, with no message.
 * Error cases:
 * - the read fails: the payouts' problem is set for the rows to say, and the next trigger reads again
 */
export async function loadPayouts(store: ConsoleStore): Promise<void> {
  const address = store.getSnapshot().wallet?.address;
  if (address === undefined) return;
  const generation = store.getSnapshot().payoutsGeneration + 1;
  store.patch({ payoutsGeneration: generation });
  const current = () => store.getSnapshot().wallet?.address === address && store.getSnapshot().payoutsGeneration === generation;
  try {
    const entries: PayoutEntry[] = [];
    let seq: number | null = null;
    let loaded = false;
    let complete = false;
    let after: number | undefined;
    for (let page = 0; page < PAYOUT_PAGES && !complete; page++) {
      const read = await store.deps.client.payouts(address, { limit: PAYOUTS_LIMIT, ...(after === undefined ? {} : { after }) });
      if (page === 0) seq = read.seq;
      entries.push(...read.payouts);
      loaded = read.loaded;
      after = read.next ?? undefined;
      complete = !read.loaded || read.next === null;
    }
    if (!current()) return;
    const state = store.getSnapshot();
    const mine = address.toLowerCase();
    const authorizations = entries.reduce((held, { nonce, withdrawal }) => {
      const signed = withdrawal !== null && withdrawal.nonce === nonce && withdrawal.authorization !== undefined && withdrawal.account.toLowerCase() === mine;
      return signed ? keepLatest(held, withdrawal) : held;
    }, state.authorizations);
    const problem = !loaded ? "The node is still loading its record of your payouts after a restart." : after !== undefined ? "The node's list of your payouts is longer than this page reads." : null;
    store.patch({
      authorizations,
      payoutsRead: problem === null && seq !== null ? { seq, listed: entries.map((e) => e.nonce) } : state.payoutsRead,
      payoutsProblem: problem === null ? null : `${problem} ${READ_AGAIN}`,
    });
  } catch (error) {
    if (!current()) return;
    // A node that predates the route has no list to read; its rows wait for the stream, as they do between checkpoints.
    store.patch({ payoutsProblem: error instanceof EngineError && error.status === 404 ? null : `The node's list of your payouts could not be read: ${errorText(error)} ${READ_AGAIN}` });
  }
}

/**
 * The payouts whose payment the vault has not been asked about: every approval the page lists, newest
 * first, then any authorization held for an approval not listed, but for those the node's list shows
 * paid. A reload may leave no authorization yet, so the vault is asked whether the payout is paid.
 */
export function unreadPayouts(state: ConsoleState): number[] {
  const approvedSeqs = new Map<number, number | undefined>();
  for (const event of approvalsListed(state)) if (event.type === "withdrawal_approved") approvedSeqs.set(event.nonce, Number(event.cursor.split(":")[0]));
  for (const { nonce, approved_seq } of state.authorizations) if (!approvedSeqs.has(nonce)) approvedSeqs.set(nonce, approved_seq);
  return [...approvedSeqs].filter(([nonce, seq]) => !state.paid.includes(nonce) && !state.unpaid.includes(nonce) && !paidByNode(state, nonce, seq)).map(([nonce]) => nonce);
}

/**
 * Reads, through the wallet's chain provider, whether the vault has paid each unread payout. One run
 * per wallet at a time, one read at a time, each taking the next unread payout as the state is then,
 * so a wallet app over WalletConnect is never handed a batch and no payout is read twice. A failed
 * read ends the run; the next run, when another authorization arrives, tries it again.
 */
export async function checkPaid(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  const address = store.getSnapshot().wallet?.address;
  if (!wallet?.claimed || address === undefined || store.paidCheck === wallet) return;
  store.paidCheck = wallet;
  const current = () => store.liveWallet === wallet && store.getSnapshot().wallet?.address === address;
  try {
    for (let nonce = unreadPayouts(store.getSnapshot())[0]; nonce !== undefined && current(); nonce = unreadPayouts(store.getSnapshot())[0]) {
      // Through the session's wallet queue, so it never asks the provider beside the MONKEY page's reads.
      const paid = await store.monkeySession.walletWork.work(wallet, () => wallet.claimed?.(nonce) ?? Promise.resolve(false));
      if (!current()) return;
      const now = store.getSnapshot();
      store.patch(paid ? { paid: [...new Set([...now.paid, nonce])] } : { unpaid: [...new Set([...now.unpaid, nonce])] });
    }
  } catch (error) {
    if (current()) store.toast("error", `The vault's payouts could not be read: ${errorText(error)}`);
  } finally {
    if (store.paidCheck === wallet) store.paidCheck = null;
  }
}

/**
 * Claims payout `nonce` on the vault with its authorization. A claim signs nothing for the node, so it
 * needs only the wallet, not a live feed: the authorization was verified when the stream carried it.
 */
export async function claim(store: ConsoleStore, nonce: number): Promise<void> {
  const signed = authorizationFor(store.getSnapshot(), nonce);
  const wallet = store.liveWallet;
  if (!wallet) return store.toast("error", "Connect a wallet first.");
  if (signed === null) return;
  const amount = formatUsdc(fixedFromWire(signed.amount));
  store.patch({ busy: true });
  try {
    await prompting(store, `Confirm in your wallet: claim ${amount} from the vault.`, () => wallet.claim(signed, (waitingFor) => store.patch({ prompt: waitingFor })));
    // The payout belongs to the account that claimed it, which may no longer be the one connected.
    const state = store.getSnapshot();
    if (state.wallet?.address === wallet.address) store.patch({ paid: [...new Set([...state.paid, nonce])] });
    store.toast("ok", `The vault paid ${amount} to ${wallet.address === state.wallet?.address ? "your wallet" : wallet.address}.`);
  } catch (error) {
    store.toast("error", errorText(error));
    // The vault may have paid it since it was read, such as on a claim from another device, so it is read again.
    const state = store.getSnapshot();
    if (state.wallet?.address === wallet.address) store.patch({ unpaid: state.unpaid.filter((n) => n !== nonce) });
  } finally {
    store.patch({ busy: false });
  }
}

/** The node's refusal of a reissue that names an older authorization than its latest, with that one's expiry (`reissue.rs`, `Reissue::Stale`). */
const NEWER_EXISTS = /^the latest authorization expires at (\d+)/;

/**
 * Asks the node to sign payout `nonce` again, replacing the authorization that expired at
 * `expiresAt`, then reads the node's payouts: when the node names a newer authorization than the
 * expired one, the answer holds it.
 */
export async function reissue(store: ConsoleStore, nonce: number, expiresAt: number): Promise<void> {
  const wallet = usableWallet(store, "sign");
  if (!wallet) return;
  // Every step after an await applies only while the wallet that asked is still the one connected.
  const asking = () => store.getSnapshot().wallet?.address === wallet.address;
  store.patch({ busy: true });
  let reread = false;
  try {
    const typed = reissueTypedData(domainOf(store), wallet.address, nonce, expiresAt);
    const summary = `ask for a new authorization of withdrawal ${nonce}`;
    const signature = await prompting(store, `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
    await store.deps.client.reissue(wallet.address, nonce, { replaces_expires_at: expiresAt, signature });
    store.toast("ok", "Requested. The new authorization arrives here once the node signs it.");
    reread = true;
  } catch (error) {
    const stale = error instanceof EngineError && error.status === 400 ? NEWER_EXISTS.exec(error.message) : null;
    if (stale?.[1] !== undefined) {
      store.toast("info", `The node has signed a newer authorization for this withdrawal, valid until ${formatStamp(Number(stale[1]) * 1000)} UTC; reading it from the node.`);
      reread = true;
    }
    // The node holds no unpaid approval under this nonce (`reissue.rs`, `Reissue::Unknown`), so the vault's record is read again.
    else if (error instanceof EngineError && error.status === 404) {
      store.toast("error", `The node holds no unpaid withdrawal ${nonce} for this account: the vault has paid it, or the node is still loading it after a restart.`);
      if (asking()) store.patch({ unpaid: store.getSnapshot().unpaid.filter((n) => n !== nonce) });
    } else if (!store.noteAccess(error)) store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
  if (reread && asking()) await loadPayouts(store);
}
