/**
 * The setup popup's state (monkey-trading/console#168): it opens once per connection, after the
 * account's first read, on any page, if the declaration or key is missing; a dismissal lasts for the
 * connection, and whatever a missing step blocks reopens it. The faucet step alone never opens it. The
 * popup's steps run the actions they name, and only a step the user finished can send them on to
 * Funding, so a reload never redirects.
 */

import { keyLive, setupGate, setupSteps, type SetupFacts } from "../setup-steps";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";
import { forgetSessionKey } from "./wallet-session";

/** The facts the steps depend on, from the console's state; `faucet` is whether this build has the dev faucet. */
export const setupFacts = (state: ConsoleState, faucet: boolean): SetupFacts => ({
  faucet,
  credited: state.account !== null,
  declared: state.eligibility !== null,
  keyed: keyLive(state),
  fundSettled: state.setup.fundSettled,
});

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
export function settleFund(store: ConsoleStore): void {
  const { setup } = store.getSnapshot();
  store.patch({ setup: { ...setup, fundSettled: true } });
}

/**
 * Called when a step the user pressed has finished: closes the popup once no step remains, and says
 * where they go. A never-credited account goes to Funding to deposit; a credited one stays where it
 * is. Null while steps remain, or when the popup was dismissed while the wallet asked.
 */
export function setupStepDone(store: ConsoleStore, faucet: boolean): "funding" | "stay" | null {
  const state = store.getSnapshot();
  if (!state.setup.open || setupSteps(setupFacts(state, faucet)).length > 0) return null;
  dismissSetup(store);
  return state.account === null ? "funding" : "stay";
}
