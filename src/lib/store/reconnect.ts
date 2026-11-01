/**
 * The wallet connection choice a previous page load stored, reconnected on load
 * (monkey-trading/console#82). An injected wallet reconnects through the existing provider flow;
 * a WalletConnect session cannot survive a reload in the SDK's memory, so a dead session falls
 * back to the pairing dialog. A reconnect the visitor cancels or that fails forgets the choice —
 * but only while it is still the stored one and no wallet is connected, so a failed or superseded
 * attempt never deletes a newer connection's choice. A reconnect also yields, silently, to a wallet
 * the visitor connected or a WalletConnect pairing they opened while the SDK loaded.
 */

import { clearChoiceIf, loadChoice, type WalletChoice } from "../engine/wallet-persist";
import type { Wallet } from "../engine/wallet";
import type { PairingState } from "../engine/walletconnect";
import { connectWallet } from "./actions";
import type { ConsoleStore } from "./store";

/** The part of the WalletConnect connector a reconnect needs; the connector passes itself. */
export interface ResumableConnector {
  resume(topic: string): Promise<Wallet | null>;
  /** The pairing the visitor has open, if any. */
  pairing(): PairingState;
}

/**
 * Forgets `expected` when it is still the stored choice: a failed or cancelled reconnect removes
 * the remembered connection, but never a newer choice another connect saved while it ran.
 */
function forgetChoice(store: ConsoleStore, expected: WalletChoice): void {
  const persistence = store.deps.persistence;
  // A connected wallet means this reconnect was superseded, not failed: the choice that wallet saved may equal `expected`.
  if (persistence === undefined || store.liveWallet !== null) return;
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
  // The visitor may have connected something, or opened their own pairing, while the SDK loaded; either wins over this reconnect.
  // The relay socket is the SDK's to leave alone: it opens none until a pairing exists, and one open belongs to the visitor.
  if (store.liveWallet !== null || walletConnect.pairing().status !== "idle") return;
  const connected = wallet === null ? await connectWallet(store, "walletconnect", true) : await connectWallet(store, "walletconnect", true, wallet);
  if (!connected) forgetChoice(store, choice);
}
