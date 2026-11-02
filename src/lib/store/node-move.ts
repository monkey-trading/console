/**
 * Moving the session to another node: a fresh store over a fresh client, around the same wallet and
 * session key. Nothing read from the old node exists in the new store, and work the old store has in
 * flight lands in a store no screen reads and finds its wallet gone, so it sends nothing. A session
 * key survives the move because it is registered in the engine's state, which an elected successor
 * takes with the log; a node that no longer holds it refuses it, and the session-signed path then
 * asks the wallet again.
 */

import type { OperatorFollower } from "../engine/operator-follow";
import { connectWallet } from "./actions";
import { installKey } from "./session";
import type { ConsoleStore } from "./store";

/**
 * Hands `old`'s wallet and key to `next`, and tells the user where the console went; the stored
 * entries need no change, since they name the account, chain and vault and no node.
 */
export async function moveToNode(old: ConsoleStore, next: ConsoleStore, host: string): Promise<void> {
  const wallet = old.liveWallet;
  const key = old.sessionKey;
  const { sessionExpiresAt } = old.getSnapshot();
  old.liveWallet = null;
  old.sessionKey = null;
  old.sessionLogin = null;
  next.toast("info", `The operator changed, so the console connected to ${host} and is verifying its attestation.`);
  if (wallet === null) return;
  // Set first, so the connect below keeps the key rather than clearing another wallet's.
  next.liveWallet = wallet;
  if (key !== null && sessionExpiresAt > 0) installKey(next, key, sessionExpiresAt);
  await connectWallet(next, wallet.topic !== undefined ? "walletconnect" : "injected", true, wallet);
}

/** Has `follower` read the chain when this store's wallet changes, and hear this store's client. Returns what stops that. */
export function followNode(store: ConsoleStore, follower: OperatorFollower): () => void {
  let wallet = store.liveWallet;
  const stopClient = follower.watch(store.deps.client);
  const stopStore = store.subscribe(() => {
    if (store.liveWallet === wallet) return;
    wallet = store.liveWallet;
    void follower.check();
  });
  return () => {
    stopClient();
    stopStore();
  };
}

/** Asks the wallet back onto the deployment's chain and judges the node again: what a wallet that wandered off, then came back, needs before anything is signed. */
export async function recheckNode(store: ConsoleStore): Promise<void> {
  try {
    await store.liveWallet?.ensureChain?.();
  } catch (error) {
    store.toast("error", error instanceof Error ? error.message : "The wallet stayed on another chain.");
    return;
  }
  await store.deps.client.verify();
}
