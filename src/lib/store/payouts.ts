/**
 * The connected account's approved withdrawals as payouts to claim on the vault: each approval's
 * signed authorization, whether the vault has paid it, and the claim, the search of the log for an
 * authorization the page's stream did not carry, and the request for a fresh one once it expired.
 */

import { reissueTypedData } from "../engine/eip712";
import type { SignedWithdrawal } from "../engine/types";
import { fixedFromWire, formatFixedPlaces, type Fixed } from "../fixed";
import { domainOf, errorText, prompting, usableWallet } from "./actions";
import { authorizationFor } from "./funds";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

/** Where one approved payout stands. */
export type PayoutStatus =
  | { kind: "paid" }
  /** Signed and claimable on the vault until `expiresAt` (Unix seconds). */
  | { kind: "claimable"; withdrawal: SignedWithdrawal; expiresAt: number }
  /** Its last authorization expired unclaimed, at `expiresAt`; a fresh one can be asked for. */
  | { kind: "expired"; expiresAt: number }
  /** Not signed yet as far as the page knows: a checkpoint covering the approval comes first. */
  | { kind: "waiting" };

export interface Payout {
  nonce: number;
  amount: Fixed;
  /** The seq of the command that approved it, where a search of the log starts. */
  approvedSeq: number;
  status: PayoutStatus;
}

/** The account's approved payouts in its history, newest first, with where each stands at node time `nowMs`. */
export function payoutsOf(state: ConsoleState): Payout[] {
  const nowSeconds = Math.floor(state.now / 1000);
  return state.history.flatMap((event) => {
    if (event.type !== "withdrawal_approved") return [];
    const approvedSeq = Number(event.cursor.split(":")[0]);
    const signed = authorizationFor(state, event.nonce);
    const expiresAt = signed?.authorization?.expires_at ?? null;
    const status: PayoutStatus = state.paid.includes(event.nonce)
      ? { kind: "paid" }
      : signed !== null && expiresAt !== null
        ? expiresAt > nowSeconds ? { kind: "claimable", withdrawal: signed, expiresAt } : { kind: "expired", expiresAt }
        : { kind: "waiting" };
    return [{ nonce: event.nonce, amount: fixedFromWire(event.amount), approvedSeq, status }];
  });
}

/** Reads, through the wallet's chain provider, which of the account's unpaid payouts the vault has paid since. */
export async function checkPaid(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  const address = store.getSnapshot().wallet?.address;
  if (!wallet || address === undefined) return;
  const unknown = payoutsOf(store.getSnapshot()).filter((p) => p.status.kind !== "paid").map((p) => p.nonce);
  try {
    const paid = (await Promise.all(unknown.map(async (nonce) => ((await wallet.claimed(nonce)) ? [nonce] : [])))).flat();
    const state = store.getSnapshot();
    if (paid.length > 0 && state.wallet?.address === address) store.patch({ paid: [...new Set([...state.paid, ...paid])] });
  } catch (error) {
    store.toast("error", `The vault's payouts could not be read: ${errorText(error)}`);
  }
}

/** Claims payout `nonce` on the vault with its authorization. */
export async function claim(store: ConsoleStore, nonce: number): Promise<void> {
  const signed = authorizationFor(store.getSnapshot(), nonce);
  const wallet = usableWallet(store, "claim");
  if (!wallet || signed === null) return;
  const amount = `$${formatFixedPlaces(fixedFromWire(signed.amount), 2)}`;
  store.patch({ busy: true });
  try {
    await prompting(store, `Confirm in your wallet: claim ${amount} USDC from the vault.`, () => wallet.claim(signed));
    store.patch({ paid: [...store.getSnapshot().paid, nonce] });
    store.toast("ok", `The vault paid ${amount} to your wallet.`);
  } catch (error) {
    store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
}

/** Searches the log from the approval for payout `nonce`'s authorization. */
export async function findAuthorization(store: ConsoleStore, nonce: number, approvedSeq: number): Promise<void> {
  const address = store.getSnapshot().wallet?.address;
  if (address === undefined) return;
  store.patch({ busy: true });
  try {
    const found = await store.deps.client.findWithdrawal(address, nonce, approvedSeq);
    const state = store.getSnapshot();
    if (state.wallet?.address !== address) return;
    if (found === null || found.authorization === undefined) store.toast("info", "The log holds no authorization for this withdrawal yet. The node signs one once a checkpoint covering the approval is confirmed on chain; it then arrives here.");
    else store.patch({ authorizations: [...state.authorizations.filter((w) => w.nonce !== nonce), found] });
  } catch (error) {
    store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
}

/** Asks the node to sign payout `nonce` again, replacing the authorization that expired at `expiresAt`. */
export async function reissue(store: ConsoleStore, nonce: number, expiresAt: number): Promise<void> {
  const wallet = usableWallet(store, "sign");
  if (!wallet) return;
  store.patch({ busy: true });
  try {
    const typed = reissueTypedData(domainOf(store), wallet.address, nonce, expiresAt);
    const summary = `ask for a new authorization of withdrawal ${nonce}`;
    const signature = await prompting(store, `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
    await store.deps.client.reissue(wallet.address, nonce, { replaces_expires_at: expiresAt, signature });
    store.toast("ok", "Requested. The new authorization arrives here once the node signs it.");
  } catch (error) {
    store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
}
