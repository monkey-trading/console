/** Ending a wallet's connection: the user's Disconnect and a session the wallet app ended. */

import type { Wallet } from "../engine/wallet";
import { clearChoice, clearChoiceIf } from "../engine/wallet-persist";
import { errorText } from "./signing";
import { liveSessionKey, revokeSession } from "./session";
import type { ConsoleStore } from "./store";

/** The state a wallet change clears: everything read or streamed for the account before. */
export const NO_ACCOUNT = { account: null, eligibility: null, queue: [], history: [], quotes: {}, quoteError: null, quoted: [], authorizations: [], approvals: [], approvalsNext: null, payoutsRead: null, payoutsProblem: null, paid: [], unpaid: [], entitlement: null, emissionsVault: null };

/** Ends a wallet's connection in the background, telling the user if that fails. */
export function release(store: ConsoleStore, wallet: Wallet | null): void {
  wallet?.disconnect?.().catch((error: unknown) => store.toast("error", `The wallet's session did not close: ${errorText(error)}`));
}

/**
 * The user's Disconnect: drops the wallet and forgets the stored connection choice, so a reload
 * does not reconnect it. A read-only watch account never stored a choice, so disconnecting it
 * leaves the choice of the connection it stands in front of.
 */
export function disconnectWallet(store: ConsoleStore): void {
  if (store.deps.persistence !== undefined && store.getSnapshot().wallet?.readOnly !== true) clearChoice(store.deps.persistence);
  dropWallet(store);
}

/**
 * The wallet app ended WalletConnect session `topic`: disconnects it and tells the user. The
 * stored choice is forgotten only if it names that session; another tab may have saved a newer
 * one, and an injected choice names no session.
 */
export function walletSessionEnded(store: ConsoleStore, topic: string): void {
  if (store.liveWallet?.label !== "WalletConnect") return;
  if (store.deps.persistence !== undefined) clearChoiceIf(store.deps.persistence, { kind: "walletconnect", topic });
  // The dead session cannot sign a revocation, so the key's registration is left to expire.
  dropWallet(store, false);
  store.toast("info", "Your wallet ended the WalletConnect session, so the console disconnected it.");
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
  store.sessionKeyExpiresAt = 0;
  store.sessionLogin = null; // a login in flight installs nothing: its wallet no longer matches
  store.sessionLoginRefusal = null;
  store.setWallet(null);
  store.patch(NO_ACCOUNT);
  store.walletCleanup = revoke && wallet && !wallet.readOnly && key !== null ? revokeThenRelease(store, wallet, key) : Promise.resolve(release(store, wallet));
}

/** Revokes the session key, then ends the wallet's session; the wallet is gone either way. */
async function revokeThenRelease(store: ConsoleStore, wallet: Wallet, key: NonNullable<ConsoleStore["sessionKey"]>): Promise<void> {
  await revokeSession(store, wallet, key);
  release(store, wallet);
}
