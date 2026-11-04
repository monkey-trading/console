/**
 * Moving the session to another node: a fresh store over a fresh client, around the same wallet,
 * session key and setup state, since the connection has not ended. Nothing read from the old node
 * exists in the new store, and work the old store has in flight lands in a store no screen reads and
 * finds its wallet gone, so it sends nothing. A session key survives the move because it is registered
 * in the engine's state, which an elected successor takes with the log; a node that no longer holds it
 * refuses it, and the session-signed path then disconnects the wallet, so reconnecting brings setup
 * back at the key's step.
 */

import type { OperatorFollower } from "../engine/operator-follow";
import { connectWallet } from "./actions";
import { installKey } from "./session";
import type { ConsoleStore } from "./store";

/** What the console tells the user once the screens have remounted on the new store, so the log that announces it exists first. The move adopted only after the node's attestation verified, so the notice says so. */
export const moveNotice = (host: string): string => `The console connected to ${host}, the node the chain names, and verified its attestation.`;

/**
 * Posts the move notice at most once per move, and holds a dismissal for the move it was made on:
 * whatever re-runs the effect — a repeated follow check, a remount — the same move announces once,
 * and only a move to another node announces again.
 */
export class MoveAnnouncer {
  private posted: { move: number; host: string } | null = null;
  private dismissed: { move: number; host: string } | null = null;

  /** The notice `move` earns, or null when this move was announced or dismissed already. */
  noticeFor(move: number, host: string): string | null {
    const held = (key: { move: number; host: string } | null) => key !== null && key.move === move && key.host === host;
    if (held(this.posted) || held(this.dismissed)) return null;
    this.posted = { move, host };
    return moveNotice(host);
  }

  /** The user dismissed the notice now showing: it stays dismissed for that move alone. */
  dismissShowing(): void {
    if (this.posted !== null) this.dismissed = this.posted;
  }
}

/** Hands `old`'s wallet, key and setup state to `next`; the stored entries need no change, since they name the account, chain and vault and no node. */
export async function moveToNode(old: ConsoleStore, next: ConsoleStore): Promise<void> {
  const wallet = old.liveWallet;
  const key = old.sessionKey;
  const { sessionExpiresAt, setup } = old.getSnapshot();
  old.movedAway = true;
  next.exit.keeper.carry(old.getSnapshot().exit, old.exit.keeper); // a proof the browser would not keep, or the wallet has not checked, lives only in the page
  old.liveWallet = null;
  old.sessionKey = null;
  old.sessionLogin = null;
  // The page load's wallet was settled on the old store; the next one starts from that.
  next.patch({ walletDecided: old.getSnapshot().walletDecided });
  if (wallet === null) return;
  // Set first, so the connect below keeps the key rather than clearing another wallet's.
  next.liveWallet = wallet;
  // Before the connect's first account read, which would otherwise decide the popup afresh over a dismissal; the wallet stays on the chain it was on.
  next.patch({ setup, walletChain: old.getSnapshot().walletChain });
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

/** Asks the wallet back onto the deployment's chain, judges the node again and reads the chain again: what a wallet that wandered off, then came back, needs before anything is signed. */
export async function recheckNode(store: ConsoleStore, follower: Pick<OperatorFollower, "check"> | null): Promise<void> {
  try {
    await store.liveWallet?.ensureChain?.();
  } catch (error) {
    store.notify("node", error instanceof Error ? error.message : "The wallet stayed on another chain.");
    return;
  }
  await store.deps.client.verify();
  await follower?.check();
  await store.exit.refresh();
}
