/**
 * The wallet connection choice a previous page load stored, reconnected on load
 * (monkey-trading/console#82). An injected wallet reconnects through the existing provider flow;
 * a WalletConnect session cannot survive a reload in the SDK's memory, so a dead session falls
 * back to the pairing dialog. A reconnect the visitor cancels or that fails forgets the choice —
 * but only while it is still the stored one, so a failed attempt never deletes a newer
 * connection's choice.
 */

import { clearChoiceIf, loadChoice, type WalletChoice } from "../engine/wallet-persist";
import type { Wallet } from "../engine/wallet";
import { connectWallet } from "./actions";
import type { ConsoleStore } from "./store";

/** The part of the WalletConnect connector a reconnect needs; the connector passes itself. */
export interface ResumableConnector {
  resume(topic: string): Promise<Wallet | null>;
}

/**
 * Forgets `expected` when it is still the stored choice: a failed or cancelled reconnect removes
 * the remembered connection, but never a newer choice another connect saved while it ran.
 */
function forgetChoice(store: ConsoleStore, expected: WalletChoice): void {
  const persistence = store.deps.persistence;
  if (persistence === undefined) return;
  clearChoiceIf(persistence, expected);
}

/**
 * Reconnects the stored choice, if any. A wallet already connected (the URL's watched account
 * connects before this runs) wins. A missing injected provider is not a failure: wallets that
 * inject late are retried on the next load.
 */
export async function reconnectWallet(store: ConsoleStore, walletConnect: ResumableConnector | null, hasInjected: () => boolean): Promise<void> {
  const persistence = store.deps.persistence;
  if (persistence === undefined || store.liveWallet !== null) return;
  const choice = loadChoice(persistence);
  if (choice === null) return;
  if (choice.kind === "injected") {
    if (!hasInjected()) return;
    if (!(await connectWallet(store, "injected", true))) forgetChoice(store, choice);
    return;
  }
  if (walletConnect === null) return;
  const wallet = await walletConnect.resume(choice.topic).catch(() => null);
  // The visitor may have connected something while the SDK loaded; it wins over the pairing dialog.
  if (store.liveWallet !== null) return;
  const connected = wallet === null ? await connectWallet(store, "walletconnect", true) : await connectWallet(store, "walletconnect", true, wallet);
  if (!connected) forgetChoice(store, choice);
}
