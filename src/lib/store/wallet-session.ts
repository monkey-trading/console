/**
 * Ending a wallet's connection: the user's Disconnect, a session the wallet app ended, a session key
 * that died, and another tab's removal of the shared key. Every way out removes the key's stored entry
 * but the last, whose tab already did. What keeps a connection honest about its key lives here too:
 * the sequenced clock passing its expiry, a stream `session_key_revoked` naming it, and the `storage`
 * event another tab's write fires (monkey-trading/console#168).
 */

import { loadSessionKey, readStoredKey, removeSessionKey, sessionKeyName, sweepSessionKeys, type StoredKey } from "../engine/session-key-store";
import type { StreamMessage } from "../engine/types";
import type { Wallet } from "../engine/wallet";
import { clearChoice, clearChoiceIf, type WalletChoice } from "../engine/wallet-persist";
import { errorText } from "./signing";
import { installKey, keyScope, liveSessionKey, revokeSession } from "./session";
import { NO_SETUP } from "./state";
import type { ConsoleStore } from "./store";

/** The state a wallet change clears: everything read or streamed for the account before. */
export const NO_ACCOUNT = { account: null, eligibility: null, queue: [], history: [], quotes: {}, quoteError: null, quoted: [], authorizations: [], approvals: [], approvalsNext: null, payoutsRead: null, payoutsProblem: null, paid: [], unpaid: [], entitlement: null, emissionsVault: null };

/** The rest a change of connection clears: its key's expiry and refusal, its setup, and a wallet request the old wallet may never answer, so the next connection's buttons are not stuck behind it. */
export const NO_SESSION = { sessionExpiresAt: 0, sessionRefusal: null, setup: NO_SETUP, busy: false, prompt: null };

/** Why a connection ended, as the toast says it. */
export const KEY_EXPIRED = "This browser's trading authorization expired, so your wallet was disconnected. Connect again to renew it.";
export const KEY_REVOKED = "This browser's trading authorization was revoked, so your wallet was disconnected. Connect again to renew it.";
export const KEY_REFUSED = "The node no longer accepts this browser's trading authorization, so your wallet was disconnected. Connect again to renew it.";
const KEY_ENDED_ELSEWHERE = "This browser's trading authorization ended in another tab, so your wallet was disconnected here too. Connect again to renew it.";

/** Ends a wallet's connection in the background, telling the user if that fails. */
export function release(store: ConsoleStore, wallet: Wallet | null): void {
  wallet?.disconnect?.().catch((error: unknown) => store.toast("error", `The wallet's session did not close: ${errorText(error)}`));
}

/**
 * The user's Disconnect: drops the wallet, forgets the stored connection choice, so a reload does
 * not reconnect it, and removes the stored key whether or not the wallet goes on to sign its
 * revocation. A read-only watch account never stored either, so disconnecting it leaves those of
 * the connection it stands in front of.
 */
export function disconnectWallet(store: ConsoleStore): void {
  const wallet = store.liveWallet;
  if (store.deps.persistence !== undefined && store.getSnapshot().wallet?.readOnly !== true) {
    clearChoice(store.deps.persistence);
    if (wallet !== null) removeSessionKey(store.deps.persistence, keyScope(store, wallet));
  }
  dropWallet(store);
}

/**
 * The wallet app ended WalletConnect session `topic`: disconnects it and tells the user. The
 * stored choice is forgotten only if it names that session; another tab may have saved a newer
 * one, and an injected choice names no session.
 */
export function walletSessionEnded(store: ConsoleStore, topic: string): void {
  if (store.liveWallet?.label !== "WalletConnect") return;
  if (store.deps.persistence !== undefined) {
    clearChoiceIf(store.deps.persistence, { kind: "walletconnect", topic });
    removeHeldKey(store, store.liveWallet);
  }
  // The dead session cannot sign a revocation, so the key's registration is left to expire.
  dropWallet(store, false);
  store.toast("info", "Your wallet ended the WalletConnect session, so the console disconnected it.");
}

/**
 * This connection's key is dead, by its expiry, a revocation, or the node's refusal: disconnects with
 * no prompt, forgets the stored choice and key, and says why. Reconnecting brings setup back at the
 * key's step. Another tab's wider choice stays: only this connection's own is forgotten.
 */
export function sessionEnded(store: ConsoleStore, why: string): void {
  const wallet = store.liveWallet;
  if (wallet === null) return;
  if (store.deps.persistence !== undefined) {
    clearChoiceIf(store.deps.persistence, ownChoice(wallet));
    removeHeldKey(store, wallet);
  }
  dropWallet(store, false);
  store.toast("info", why);
}

/** The stored choice that names this connection. */
const ownChoice = (wallet: Wallet): WalletChoice => (wallet.topic === undefined ? { kind: "injected" } : { kind: "walletconnect", topic: wallet.topic });

/** Removes the stored entry while it holds the key this connection holds; another tab's newer key stays. */
function removeHeldKey(store: ConsoleStore, wallet: Wallet): void {
  if (store.deps.persistence !== undefined && store.sessionKey !== null) removeSessionKey(store.deps.persistence, keyScope(store, wallet), store.sessionKey.address);
}

/** Drops this connection's key with no disconnect, for a node that cannot hold it (`decideSetup`); setup then asks for a new one. */
export function forgetSessionKey(store: ConsoleStore): void {
  if (store.liveWallet !== null) removeHeldKey(store, store.liveWallet);
  store.sessionKey = null;
  store.patch({ sessionExpiresAt: 0 });
}

/**
 * Adopts the key stored for this wallet's account, chain and vault, when this connection has none,
 * with no signature. What it found says what to do about one that has expired.
 */
export function adoptStoredKey(store: ConsoleStore, wallet: Wallet): StoredKey["kind"] {
  const storage = store.deps.persistence;
  if (storage === undefined || wallet.readOnly === true || liveSessionKey(store) !== null) return "none";
  const found = loadSessionKey(storage, keyScope(store, wallet), store.getSnapshot().now);
  if (found.kind === "live") installKey(store, found.signer, found.expiresAt);
  return found.kind;
}

/** The stream said `session_key_revoked`: disconnects when it names this browser's key for this account. */
export function noteSessionRevoked(store: ConsoleStore, events: StreamMessage["events"]): void {
  const held = store.sessionKey?.address.toLowerCase();
  const account = store.liveWallet?.address.toLowerCase();
  if (held === undefined || account === undefined) return;
  if (events.some((e) => e.type === "session_key_revoked" && e.session_key.toLowerCase() === held && e.account.toLowerCase() === account)) sessionEnded(store, KEY_REVOKED);
}

/**
 * Another tab wrote `name` (null when it cleared the whole storage), as the `storage` event reports
 * it. A new key for this account is adopted, so a tab finishes setup with the tab that did it. A
 * removal, or a value this console would not use, disconnects a tab that held a key, with no prompt,
 * and forgets the stored choice if it names this connection; the tab that removed the key revokes it.
 */
export function storedKeyChanged(store: ConsoleStore, name: string | null, value: string | null): void {
  const wallet = store.liveWallet;
  if (wallet === null || wallet.readOnly === true || store.deps.persistence === undefined) return;
  const scope = keyScope(store, wallet);
  if (name !== null && name !== sessionKeyName(scope)) return;
  const { now, sessionExpiresAt } = store.getSnapshot();
  const found = name === null ? null : readStoredKey(value, scope, now);
  if (found?.kind === "live") {
    if (found.signer.address !== store.sessionKey?.address || found.expiresAt !== sessionExpiresAt) installKey(store, found.signer, found.expiresAt);
    return;
  }
  if (sessionExpiresAt === 0) return; // this tab holds no key, so nothing of it has ended
  clearChoiceIf(store.deps.persistence, ownChoice(wallet));
  dropWallet(store, false);
  store.toast("info", KEY_ENDED_ELSEWHERE);
}

/**
 * Follows the sequenced clock for as long as the store runs: the moment it passes the key's expiry
 * the connection ends. Once a connection has adopted its own entry, the first clock this page knows
 * sweeps the dead entries no connection may come back to; sooner would take a reload's own expired
 * key away from it before the reload could say so. Returns the unsubscribe.
 */
export function followSessionKey(store: ConsoleStore): () => void {
  let swept = false;
  return store.subscribe(() => {
    const { now, sessionExpiresAt, setup } = store.getSnapshot();
    if (!swept && now > 0 && setup.decided && store.deps.persistence !== undefined) {
      swept = true;
      sweepSessionKeys(store.deps.persistence, now);
    }
    if (sessionExpiresAt > 0 && sessionExpiresAt <= now) sessionEnded(store, KEY_EXPIRED);
  });
}

/**
 * Drops the wallet and any session key. With `revoke` (the user's Disconnect), a live session key
 * is revoked first, best effort, while the wallet's session can still sign; the revocation and
 * release are the store's `walletCleanup`, which the next connect awaits so a WalletConnect relay
 * is never closed under a fresh pairing.
 */
function dropWallet(store: ConsoleStore, revoke = true): void {
  const wallet = store.liveWallet;
  const key = liveSessionKey(store);
  store.liveWallet = null;
  store.sessionKey = null;
  store.sessionLogin = null; // a login in flight installs nothing: its wallet no longer matches
  store.setWallet(null);
  store.patch({ ...NO_ACCOUNT, ...NO_SESSION });
  store.walletCleanup = revoke && wallet && !wallet.readOnly && key !== null ? revokeThenRelease(store, wallet, key) : Promise.resolve(release(store, wallet));
}

/** Revokes the session key, then ends the wallet's session; the wallet is gone either way. */
async function revokeThenRelease(store: ConsoleStore, wallet: Wallet, key: NonNullable<ConsoleStore["sessionKey"]>): Promise<void> {
  await revokeSession(store, wallet, key);
  release(store, wallet);
}
