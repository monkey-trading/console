/**
 * Moving the session to another node: a fresh store over a fresh client, around the same wallet,
 * session key and setup state, since the connection has not ended. Nothing read from the old node
 * exists in the new store but the chart's bars, which the new node's marks then extend, and work
 * the old store has in flight lands in a store no screen reads and finds its wallet gone, so it
 * sends nothing. The follower moves only once no request is in flight, so what a request's control
 * says of its outcome, such as an order sent as the old node went down, moves with the market and
 * timeframe on screen; what was said of the old node's reads does not. A session key, and every
 * nonce, survives the move because they are in the engine's state, which a successor takes with the
 * log; a node that no longer holds the key refuses it, and the session-signed path then disconnects
 * the wallet, so reconnecting brings setup back at the key's step.
 */

import type { OperatorFollower } from "../engine/operator-follow";
import { connectWallet } from "./actions";
import { installKey } from "./session";
import type { Notices, NoticeSurface } from "./state";
import type { ConsoleStore } from "./store";

/** The surfaces whose notices are about the node moved away from, its reads, feed and chart, rather than what a request came to. */
const LEFT_BEHIND: ReadonlySet<NoticeSurface> = new Set(["node", "feed", "accountRead", "payoutReads", "chart"]);

/** What `notices` says that still holds on another node: each request's outcome where the trader made it. */
export function carriedNotices(notices: Notices): Notices {
  return Object.fromEntries(Object.entries(notices).filter(([surface]) => !LEFT_BEHIND.has(surface as NoticeSurface))); // the keys are `Notices`' own
}

/** Hands `old`'s wallet, key and setup state to `next`; the stored entries need no change, since they name the account, chain and vault and no node. */
export async function moveToNode(old: ConsoleStore, next: ConsoleStore): Promise<void> {
  const wallet = old.liveWallet;
  const key = old.sessionKey;
  const { sessionExpiresAt, setup } = old.getSnapshot();
  old.movedAway = true;
  next.exit.keeper.carry(old.getSnapshot().exit, old.exit.keeper); // a proof the browser would not keep, or the wallet has not checked, lives only in the page
  next.barsSeed.carry(old.getSnapshot()); // the chart keeps the verified bars it showed, and the new node's marks merge into them
  old.liveWallet = null;
  old.sessionKey = null;
  old.sessionLogin = null;
  const { walletDecided, selected, timeframe } = old.getSnapshot();
  // The page load's wallet was settled on the old store; the next one starts from that, on the same market and timeframe.
  next.patch({ walletDecided, selected, timeframe });
  carryOutcomes(old, next);
  if (wallet === null) return;
  // Set first, so the connect below keeps the key rather than clearing another wallet's.
  next.liveWallet = wallet;
  // Before the connect's first account read, which would otherwise decide the popup afresh over a dismissal; the wallet stays on the chain it was on.
  next.patch({ setup, walletChain: old.getSnapshot().walletChain });
  if (key !== null && sessionExpiresAt > 0) installKey(next, key, sessionExpiresAt);
  await connectWallet(next, wallet.topic !== undefined ? "walletconnect" : "injected", true, wallet);
}

/**
 * Says on `next` what each request came to on `old`: what it said before the move, again the moment connecting the same wallet clears its
 * surfaces, and what it says after, as a request whose outcome lands only once its refresh ends, while the account is the same and until
 * the trader sends a request on `next`, whose own outcome a late one must never be read as.
 */
function carryOutcomes(old: ConsoleStore, next: ConsoleStore): void {
  const account = old.getSnapshot().wallet?.address.toLowerCase();
  let carried = carriedNotices(old.getSnapshot().notices);
  let sentOnNext = false;
  const sameAccount = () => next.getSnapshot().wallet?.address.toLowerCase() === account;
  const say = () => {
    const current = next.getSnapshot().notices;
    const missing = Object.entries(carried).filter(([surface, notice]) => current[surface as NoticeSurface]?.id !== notice.id); // the keys are `Notices`' own
    if (missing.length > 0) next.patch({ notices: { ...current, ...Object.fromEntries(missing) } });
  };
  next.patch({ notices: carried });
  // Until the wallet is connected again its surfaces may be cleared once; after that, nothing else of the old store's carries over.
  const stopNext = next.subscribe(() => {
    if (!sameAccount()) return;
    stopNext();
    say();
  });
  const stopSent = next.subscribe(() => {
    if (!next.getSnapshot().busy) return;
    sentOnNext = true;
    stopSent();
  });
  // Never stopped: the listener goes with the old store, which nothing holds once its last request has ended.
  old.subscribe(() => {
    const later = carriedNotices(old.getSnapshot().notices);
    const fresh = Object.entries(later).filter(([surface, notice]) => carried[surface as NoticeSurface]?.id !== notice.id);
    carried = later;
    if (fresh.length > 0 && !sentOnNext && (account === undefined || sameAccount())) next.patch({ notices: { ...next.getSnapshot().notices, ...Object.fromEntries(fresh) } });
  });
}

/**
 * Has `follower` read the chain when this store's wallet changes, and again the moment a request ends that a change of server was held
 * for, and hear this store's client. Returns what stops that.
 */
export function followNode(store: ConsoleStore, follower: Pick<OperatorFollower, "watch" | "check" | "getSnapshot">): () => void {
  let wallet = store.liveWallet;
  let busy = store.getSnapshot().busy;
  const stopClient = follower.watch(store.deps.client);
  const stopStore = store.subscribe(() => {
    const ended = busy && !store.getSnapshot().busy;
    busy = store.getSnapshot().busy;
    const held = follower.getSnapshot();
    if (ended && held.kind === "waiting" && held.stage === "wallet") void follower.check();
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
    store.notify("node", error instanceof Error ? error.message : "Your wallet is still connected to a different chain.");
    return;
  }
  await store.deps.client.verify();
  await follower?.check();
  await store.exit.refresh();
}
