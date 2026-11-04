/**
 * Following the connected wallet's own changes (monkey-trading/console#289): another account in the
 * wallet becomes the console's, with its own setup, positions and session key, never the last one's;
 * a wallet that shares no account any more is disconnected; and while the wallet is on another chain
 * than the deployment's, every request to it waits, each control saying to switch back.
 */

import type { Wallet } from "../engine/wallet";
import type { ConsoleStore } from "./store";
import { walletLeft } from "./wallet-session";

/** The stop of each store's follow, so a store follows one wallet at a time. */
const following = new WeakMap<ConsoleStore, () => void>();

/**
 * Follows `wallet` for `store` while it is the connected one; anything it says once another wallet,
 * or none, is connected stops the follow. `adopt` connects the account the wallet moved to.
 */
export function followWallet(store: ConsoleStore, wallet: Wallet, adopt: (next: Wallet) => Promise<unknown>): void {
  following.get(store)?.();
  following.delete(store);
  if (wallet.follow === undefined || wallet.readOnly === true) return;
  const live = () => {
    if (store.liveWallet === wallet) return true;
    if (following.get(store) === stop) following.delete(store);
    stop();
    return false;
  };
  const stop = wallet.follow({
    account: (next) => {
      if (!live()) return;
      // The last account's key stays stored for it, so switching back needs no signature; nothing of it is revoked or ended.
      store.liveWallet = null;
      void adopt(next);
    },
    gone: () => {
      if (live()) walletLeft(store);
    },
    chain: (chainId) => {
      if (live()) store.patch({ walletChain: chainId === store.deps.client.deployment.chainId ? null : chainId });
    },
  });
  following.set(store, stop);
}
