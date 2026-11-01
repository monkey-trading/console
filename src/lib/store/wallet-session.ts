/** Ending a wallet's connection: the user's Disconnect and a session the wallet app ended. */

import type { Wallet } from "../engine/wallet";
import { clearChoice, clearChoiceIf } from "../engine/wallet-persist";
import { errorText } from "./actions";
import type { ConsoleStore } from "./store";

/** The state a wallet change clears: everything read or streamed for the account before. */
export const NO_ACCOUNT = { account: null, eligibility: null, queue: [], history: [], quotes: {}, quoteError: null, quoted: [], authorizations: [], approvals: [], approvalsNext: null, payoutHints: {}, searching: null, paid: [], unpaid: [], entitlement: null, emissionsVault: null };

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
  dropWallet(store);
  store.toast("info", "Your wallet ended the WalletConnect session, so the console disconnected it.");
}

function dropWallet(store: ConsoleStore): void {
  release(store, store.liveWallet);
  store.liveWallet = null;
  store.setWallet(null);
  store.patch(NO_ACCOUNT);
}
