/**
 * The connected account's approved withdrawals as payouts to claim on the vault: each approval's
 * signed authorization, whether the vault has paid it, and the claim, the search of the log for an
 * authorization the page's stream did not carry, and the request for a fresh one once it expired.
 */

import { EngineError } from "../engine/client";
import { reissueTypedData } from "../engine/eip712";
import type { SignedWithdrawal } from "../engine/types";
import { fixedFromWire, type Fixed } from "../fixed";
import { formatUsdc } from "../vault";
import { domainOf, errorText, prompting, usableWallet } from "./actions";
import { formatStamp } from "../time";
import { authorizationFor, keepLatest } from "./funds";
import type { ConsoleState, PayoutHint } from "./state";
import type { ConsoleStore } from "./store";

/** The most approvals one read of the account's history returns: the node's page limit. */
const APPROVALS_LIMIT = 200;
/** The most pages of approvals read, so a node that keeps answering with more cannot keep the page reading. */
const APPROVAL_PAGES = 20;
/** Paid payouts shown beside the unpaid ones, newest first. */
const PAID_SHOWN = 5;

/** Where one approved payout stands. */
export type PayoutStatus =
  | { kind: "paid" }
  /** Signed and claimable on the vault until `expiresAt` (Unix seconds). */
  | { kind: "claimable"; withdrawal: SignedWithdrawal; expiresAt: number }
  /** The node signed a newer authorization, valid until `expiresAt`, which the page has not seen. */
  | { kind: "missed"; expiresAt: number }
  /** Its last authorization expired unclaimed, at `expiresAt`; a fresh one can be asked for. */
  | { kind: "expired"; expiresAt: number }
  /** Not signed yet as far as the page knows: a checkpoint covering the approval comes first. */
  | { kind: "waiting" };

export interface Payout {
  nonce: number;
  amount: Fixed;
  /** Where a search of the log for its latest authorization starts: the approval, or a later reissue. */
  searchFrom: number;
  status: PayoutStatus;
  /** Whether the vault's record of the payout has been read, so an unpaid status is known rather than assumed. */
  read: boolean;
}

/** Where payout `nonce` stands at node time `nowSeconds`. */
function statusOf(state: ConsoleState, nonce: number, nowSeconds: number): PayoutStatus {
  if (state.paid.includes(nonce)) return { kind: "paid" };
  const signed = authorizationFor(state, nonce);
  const held = signed?.authorization?.expires_at ?? 0;
  const newer = state.payoutHints[nonce]?.newerUntil ?? 0;
  if (newer > held) return newer > nowSeconds ? { kind: "missed", expiresAt: newer } : { kind: "expired", expiresAt: newer };
  if (signed === null || held === 0) return { kind: "waiting" };
  return held > nowSeconds ? { kind: "claimable", withdrawal: signed, expiresAt: held } : { kind: "expired", expiresAt: held };
}

/** Every unpaid payout of the account's approvals and recent history, newest first, then its newest paid ones, with where each stands at node time. */
export function payoutsOf(state: ConsoleState): Payout[] {
  const nowSeconds = Math.floor(state.now / 1000);
  // The recent history has the newest approvals even when the separate read of them failed or lags.
  const recent = state.history.filter((e) => e.type === "withdrawal_approved" && !state.approvals.some((a) => a.type === "withdrawal_approved" && a.nonce === e.nonce));
  const all = [...recent, ...state.approvals].flatMap((event) => {
    if (event.type !== "withdrawal_approved") return [];
    const approvedSeq = Number(event.cursor.split(":")[0]);
    const searchFrom = Math.max(approvedSeq, state.payoutHints[event.nonce]?.searchFrom ?? 0);
    const status = statusOf(state, event.nonce, nowSeconds);
    return [{ nonce: event.nonce, amount: fixedFromWire(event.amount), searchFrom, status, read: status.kind === "paid" || state.unpaid.includes(event.nonce) }];
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

/** The payouts the page holds an authorization for, which a claim or a reissue acts on, whose payment the vault has not been asked about. */
export function unreadPayouts(state: ConsoleState): number[] {
  return state.authorizations.map((w) => w.nonce).filter((nonce) => !state.paid.includes(nonce) && !state.unpaid.includes(nonce));
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
      const paid = await wallet.claimed(nonce);
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

/** Searches the log from `fromSeq` for payout `nonce`'s latest authorization; nothing else waits on the search. */
export async function findAuthorization(store: ConsoleStore, nonce: number, fromSeq: number): Promise<void> {
  const address = store.getSnapshot().wallet?.address;
  if (address === undefined || store.getSnapshot().searching !== null) return;
  store.patch({ searching: nonce });
  try {
    const { withdrawal, complete, reached } = await store.deps.client.findWithdrawal(address, nonce, fromSeq);
    const state = store.getSnapshot();
    if (state.wallet?.address !== address) return;
    if (withdrawal?.authorization !== undefined) store.patch({ authorizations: keepLatest(state.authorizations, withdrawal) });
    // The next search reads on from where this one stopped.
    if (!complete && reached !== null) hint(store, nonce, { searchFrom: reached });
    if (!complete) store.toast("info", "The search of the log stopped before reaching its end, so a newer authorization may still be there. Search again to read on.");
    else if (withdrawal?.authorization === undefined) store.toast("info", "The log holds no authorization for this withdrawal yet. The node signs one once a checkpoint covering the approval is confirmed on chain; it then arrives here.");
  } catch (error) {
    store.toast("error", errorText(error));
  } finally {
    store.patch({ searching: null });
  }
}

/** The node's refusal of a reissue that names an older authorization than its latest, with that one's expiry (`reissue.rs`, `Reissue::Stale`). */
const NEWER_EXISTS = /^the latest authorization expires at (\d+)/;

/** Records what the page learnt of payout `nonce`'s authorizations. */
function hint(store: ConsoleStore, nonce: number, learnt: PayoutHint): void {
  const hints = store.getSnapshot().payoutHints;
  store.patch({ payoutHints: { ...hints, [nonce]: { ...hints[nonce], ...learnt } } });
}

/**
 * Asks the node to sign payout `nonce` again, replacing the authorization that expired at
 * `expiresAt`, and keeps where in the log the new one will land. When the node names a newer one the
 * page missed, an expired one is replaced in turn, and an unexpired one is searched for from `fromSeq`.
 */
export async function reissue(store: ConsoleStore, nonce: number, expiresAt: number, fromSeq: number, retried = false): Promise<void> {
  const wallet = usableWallet(store, "sign");
  if (!wallet) return;
  // Every step after an await applies only while the wallet that asked is still the one connected.
  const asking = () => store.getSnapshot().wallet?.address === wallet.address;
  store.patch({ busy: true });
  let newer: number | null = null;
  try {
    // A signed read of the log head before the request: the new authorization can only land after it.
    const { seq: before } = await store.deps.client.withdrawalQueue(wallet.address);
    const typed = reissueTypedData(domainOf(store), wallet.address, nonce, expiresAt);
    const summary = `ask for a new authorization of withdrawal ${nonce}`;
    const signature = await prompting(store, `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
    await store.deps.client.reissue(wallet.address, nonce, { replaces_expires_at: expiresAt, signature });
    if (before !== null && asking()) hint(store, nonce, { searchFrom: before });
    store.toast("ok", "Requested. The new authorization arrives here once the node signs it.");
  } catch (error) {
    const stale = error instanceof EngineError && error.status === 400 ? NEWER_EXISTS.exec(error.message) : null;
    if (stale?.[1] !== undefined) newer = Number(stale[1]);
    // The node holds no unpaid approval under this nonce (`reissue.rs`, `Reissue::Unknown`), so the vault's record is read again.
    else if (error instanceof EngineError && error.status === 404) {
      store.toast("error", `The node holds no unpaid withdrawal ${nonce} for this account: the vault has paid it, or the node is still loading it after a restart.`);
      if (asking()) store.patch({ unpaid: store.getSnapshot().unpaid.filter((n) => n !== nonce) });
    } else if (!store.noteAccess(error)) store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
  if (newer === null || !asking()) return;
  hint(store, nonce, { newerUntil: newer });
  if (newer * 1000 <= store.getSnapshot().now && !retried) return reissue(store, nonce, newer, fromSeq, true);
  store.toast("info", `The node has signed a newer authorization for this withdrawal, valid until ${formatStamp(newer * 1000)} UTC; looking for it in the log.`);
  await findAuthorization(store, nonce, fromSeq);
}
