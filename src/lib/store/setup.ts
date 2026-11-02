/**
 * The setup popup's state (monkey-trading/console#168, #199): it opens once per connection, after the
 * account's first read, on any page, for a wallet with no recorded declaration; a dismissal lasts for
 * the connection. It lists every step from start to finish and stays open until the user closes it,
 * the last step being the deposit itself. A declared wallet never sees it: its key is asked for by the
 * wallet's own prompt (`connectWallet`, `sessionSigned`).
 */

import type { Fixed } from "../fixed";
import { keyLive, setupGate, type SetupFacts } from "../setup-steps";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";
import { forgetSessionKey } from "./wallet-session";

/** The facts the steps depend on, from the console's state; `faucet` is whether this build has the dev faucet. */
export const setupFacts = (state: ConsoleState, faucet: boolean): SetupFacts => {
  const sent = state.setup.deposit;
  return {
    faucet,
    fund: state.setup.fund,
    walletHolds: state.walletUsdc.read.status === "held" ? state.walletUsdc.read.amount : null,
    credited: state.account !== null,
    declared: state.eligibility,
    keyUntil: keyLive(state) ? state.sessionExpiresAt : null,
    deposit: sent === null ? null : { amount: sent.amount, credited: (state.account?.balance ?? 0n) > sent.balanceBefore },
  };
};

/** Whether the popup shows now: never for a watched account, nor for a visitor the node refuses or has not yet answered. */
export const setupVisible = (state: ConsoleState): boolean =>
  state.setup.open && state.accessChecked && state.blocked === null && state.wallet !== null && state.wallet.readOnly !== true;

/**
 * Runs after every account read that finished. A key follows a declaration, so a node that holds
 * neither the account nor its declaration cannot hold this one (a restarted dev chain, the mock's
 * reset), and it goes without being tried; `keyAtRead` is the key held when the read began, since a key
 * installed since then is newer than what the read says. The first read of a connection then decides
 * the popup.
 */
export function decideSetup(store: ConsoleStore, keyAtRead: ConsoleStore["sessionKey"]): void {
  const wallet = store.liveWallet;
  if (wallet === null || wallet.readOnly === true) return;
  const read = store.getSnapshot();
  if (read.account === null && read.eligibility === null && read.sessionExpiresAt > 0 && store.sessionKey === keyAtRead) forgetSessionKey(store);
  if (read.setup.decided) return;
  const state = store.getSnapshot();
  const setup = { ...state.setup, decided: true };
  store.patch({ setup: { ...setup, open: setupGate({ ...state, setup }) === "needed" } });
}

/** Reopens setup, from wherever a missing step blocks something. */
export function openSetup(store: ConsoleStore): void {
  const state = store.getSnapshot();
  if (state.wallet !== null && state.wallet.readOnly !== true) store.patch({ setup: { ...state.setup, open: true } });
}

/** Closes setup for this connection, until something reopens it. */
export function dismissSetup(store: ConsoleStore): void {
  const { setup } = store.getSnapshot();
  if (setup.open) store.patch({ setup: { ...setup, open: false } });
}

/** The faucet step was used or skipped, and is not offered again on this connection. */
export function settleFund(store: ConsoleStore, how: "minted" | "skipped"): void {
  const { setup } = store.getSnapshot();
  store.patch({ setup: { ...setup, fund: how } });
}

/** The wallet sent a deposit of `amount`; the deposit step counts it credited once the account's balance rises past what it was now. */
export function noteDeposit(store: ConsoleStore, amount: Fixed): void {
  const { setup, account } = store.getSnapshot();
  store.patch({ setup: { ...setup, deposit: { amount, balanceBefore: account?.balance ?? 0n } } });
}
