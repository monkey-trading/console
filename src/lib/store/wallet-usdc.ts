/**
 * The connected wallet's USDC on the custody chain (monkey-trading/console#199): read through the
 * wallet's own provider, one read at a time, for the deposit form and the setup popup. A wallet on
 * another chain is named, not moved; a read that fails is a state of its own, never a zero.
 */

import type { ConsoleStore } from "./store";
import type { UsdcRead } from "./state";

/** Reads the balance into the store. A read already running is left to finish, unless `supersede` says the balance has just changed (a mint, a deposit), when it reads again after it. */
export async function readWalletUsdc(store: ConsoleStore, supersede = false): Promise<void> {
  const wallet = store.liveWallet;
  if (wallet === null || wallet.readOnly === true || wallet.usdcBalance === undefined) return;
  const running = store.getSnapshot().walletUsdc;
  if (running.phase !== "idle") {
    if (supersede) store.patch({ walletUsdc: { ...running, phase: "again" } });
    return;
  }
  store.patch({ walletUsdc: { ...running, phase: "reading" } });
  let read: UsdcRead;
  try {
    const found = await wallet.usdcBalance();
    read = found.kind === "held" ? { status: "held", amount: found.amount } : { status: "wrong_chain", chainId: found.chainId };
  } catch {
    // Shown as "could not be read"; the reason is the wallet's or the chain's, and a retry is the only remedy.
    read = { status: "failed" };
  }
  // A connection that ended meanwhile cleared this state already; the next one reads for itself.
  if (store.liveWallet !== wallet) return;
  const again = store.getSnapshot().walletUsdc.phase === "again";
  store.patch({ walletUsdc: { read, phase: "idle" } });
  if (again) await readWalletUsdc(store);
}

/** How often the balance is read while its form is on screen and the tab is visible: slowly, as it changes only when the wallet's own transactions, or its owner's, move it. */
export const USDC_POLL_MS = 30_000;

/** What `followWalletUsdc` needs from the page. */
export interface PageWatch {
  /** Whether the tab is showing. */
  visible(): boolean;
  /** Calls `listener` when the user comes back to the tab, such as after switching chain in the wallet; returns the unsubscribe. */
  returned(listener: () => void): () => void;
}

/** Reads now, on every return to the tab and every `USDC_POLL_MS` while it shows; returns the stop. */
export function followWalletUsdc(store: ConsoleStore, page: PageWatch): () => void {
  const read = () => { if (page.visible()) void readWalletUsdc(store); };
  void readWalletUsdc(store);
  const timer = setInterval(read, USDC_POLL_MS);
  const unsubscribe = page.returned(read);
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
