"use client";

/** Creates the store once, over the in-browser mock node or a live node by the build's deployment, follows the node's clock, and shares them. */

import { createContext, Fragment, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { parseDeploy, rawDeploy } from "@/lib/engine/deploy";
import { loadSessionKeySigner } from "@/lib/engine/session-key-class";
import type { FollowStatus } from "@/lib/engine/operator-follow";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { queuePage } from "@/lib/mock/funds";
import { mockHistory } from "@/lib/mock/history";
import { createMockNode, SIM_EPOCH_MS } from "@/lib/mock";
import { connectWallet, storedKeyChanged } from "@/lib/store/actions";
import { followNode, MoveAnnouncer } from "@/lib/store/node-move";
import { reconnectWallet } from "@/lib/store/reconnect";
import { followAccountFeeds, quoteSyncKey, syncQuotes } from "@/lib/store/funds";
import { ConsoleStore } from "@/lib/store/store";
import type { ConsoleState } from "@/lib/store/state";

import { createPrefs, exitStorage, injectedProvider, scheduler, type Session } from "./session-env";

const SessionContext = createContext<Session | null>(null);

/** How often the page advances the mock node, in milliseconds. */
const TICK_MS = 1_000;

/** The session over the in-browser node, built at once; null for a build that pins a live node, whose session is built apart from the page (`createLiveSession`). */
function createMockSession(): Session | null {
  const deploy = parseDeploy(rawDeploy());
  if (deploy.mode !== "mock") return null;
  const node = createMockNode(SIM_EPOCH_MS, true);
  const store = new ConsoleStore({
    client: node.client,
    wallets: node.wallets,
    exitStorage,
    drive: (ms) => node.client.tick(ms),
    history: mockHistory,
    initial: { markets: node.client.marketViews(), house: node.client.houseView(), startMs: SIM_EPOCH_MS, recent: node.client.recentLog(1000), viewer: DEMO_ADDRESS, housePanel: node.client.housePanelSnapshot(),
      session: {
        wallet: { address: DEMO_ADDRESS, label: "Browser wallet" },
        account: node.client.accountView(DEMO_ADDRESS),
        eligibility: node.client.eligibilityClass(DEMO_ADDRESS),
        queue: queuePage(node.client.state, DEMO_ADDRESS).queue,
        history: node.client.historyPage(DEMO_ADDRESS, { limit: 100 }).events,
      },
    },
  });
  return { store, deploy, node, walletConnect: null, prefs: createPrefs(), follower: null, moves: 0, announcer: new MoveAnnouncer() };
}

/** The most simulated time one tick may add, so a stalled timer does not jump the prices. */
const MAX_TICK_MS = 5_000;

/**
 * Provides the console's session to every screen. A live node sets its own clock with its
 * messages. The mock's clock starts at the demo's fixed instant and advances with real time, but
 * only while the simulation runs: it stands still when the user pauses it, when the tab is hidden,
 * and from the start for a visitor who prefers reduced motion, until they press play.
 */
export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [built, setBuilt] = useState(createMockSession);
  const [failure, setFailure] = useState<Error | null>(null);
  // A build that pins a node builds its session here, once the browser has the page: the connectors, the verifier and the wallet's
  // chain code (viem and its curves among them) are a chunk of their own, so the first paint waits for none of it. Nothing of a live
  // node shows before its attestation passes, so the page has nothing to show until then either.
  useEffect(() => {
    if (built !== null) return;
    let current = true;
    void import("./live-session-setup")
      .then(({ createLiveSession }) => createLiveSession(parseDeploy(rawDeploy())))
      .then((session) => { if (current) setBuilt(session); }, (error: unknown) => { if (current) setFailure(error instanceof Error ? error : new Error(String(error))); });
    return () => { current = false; };
  }, [built]);
  // A session that cannot be built is as fatal as it was when it was built in the render.
  if (failure !== null) throw failure;
  if (built === null) return <p role="status" className="min-h-dvh bg-ink-1 p-6 text-data text-fg-2">Loading the console…</p>;
  return <LoadedConsole initial={built}>{children}</LoadedConsole>;
}

/** The provider over a built session: its reads, follows and clock. */
function LoadedConsole({ initial, children }: { initial: Session; children: ReactNode }) {
  const [session, setSession] = useState(initial);
  const { store, follower, onMove } = session;
  /** Set once a stored choice has been reconnected, so a repeated effect run (React StrictMode) does not start a second one. */
  const reconnected = useRef(false);
  // A move to another node swaps in its fresh store, and the key below remounts every screen on it.
  useEffect(() => onMove?.((next) => setSession((held) => ({ ...held, store: next, moves: held.moves + 1 }))), [onMove]);
  useEffect(() => {
    if (follower === null) return;
    const stop = follower.start(() => document.visibilityState === "hidden");
    const seen = () => { if (document.visibilityState !== "hidden") follower.resume(); };
    document.addEventListener("visibilitychange", seen);
    return () => {
      document.removeEventListener("visibilitychange", seen);
      stop();
    };
  }, [follower]);
  // After a move every screen has remounted: the notice row announces this, and focus that fell with the old screens goes somewhere deliberate.
  useEffect(() => {
    if (session.moves === 0 || follower === null) return;
    const notice = session.announcer.noticeFor(session.moves, new URL(follower.getSnapshot().origin).host);
    if (notice !== null) store.notify("node", notice, "info");
    if (document.activeElement === null || document.activeElement === document.body) document.getElementById("main")?.focus();
  }, [session.moves, session.announcer, store, follower]);
  useEffect(() => (follower === null ? undefined : followNode(store, follower)), [follower, store]);
  useEffect(() => {
    const stop = store.exit.follow({ scheduler, hidden: () => document.visibilityState === "hidden", nowMs: () => Date.now() });
    const seen = () => { if (document.visibilityState !== "hidden") store.exit.seen(); };
    document.addEventListener("visibilitychange", seen);
    return () => { document.removeEventListener("visibilitychange", seen); stop(); };
  }, [store]);
  useEffect(() => {
    if (session.node === null) {
      // A live node sets the clock with its first message; the page follows it, and the account the address names.
      const stopLive = store.start(0);
      const stopFeeds = followAccountFeeds(store);
      // An address in the URL names the account to watch; it wins over a stored connection
      // choice, which would otherwise replace the read-only view when its wallet answers.
      if (new URLSearchParams(window.location.search).has("account")) void connectWallet(store, "watch", true).finally(() => store.patch({ walletDecided: true }));
      else if (!reconnected.current) {
        reconnected.current = true;
        void reconnectWallet(store, session.walletConnect, () => injectedProvider() !== undefined).finally(() => store.patch({ walletDecided: true }));
      }
      return () => {
        stopFeeds();
        stopLive();
      };
    }
    const stop = store.start(SIM_EPOCH_MS);
    // The demo account is connected on load, so no screen starts empty. Its login signs with a session key, whose signer (and the curves under it) loads after the page does.
    void loadSessionKeySigner().then(() => connectWallet(store, "browser", true)).finally(() => store.patch({ walletDecided: true }));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) store.setPaused(true);
    let simulated = SIM_EPOCH_MS;
    let last = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const running = () => !store.getSnapshot().paused && document.visibilityState !== "hidden";
    const step = () => {
      const now = Date.now();
      simulated += Math.min(now - last, MAX_TICK_MS);
      last = now;
      store.tick(simulated);
    };
    // The timer exists only while the simulation runs, so nothing ticks when paused or hidden.
    const sync = () => {
      if (running() && timer === null) {
        last = Date.now();
        timer = setInterval(step, TICK_MS);
      } else if (!running() && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    const unsubscribe = store.subscribe(sync);
    return () => {
      if (timer !== null) clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      unsubscribe();
      stop();
    };
  }, [store, session]);
  useEffect(() => {
    if (session.node !== null) return;
    // The session key is shared between this browser's tabs: another tab's write reaches this one here, and never its own.
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage) storedKeyChanged(store, event.key);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, session.node]);
  useEffect(() => {
    if (session.node !== null) return;
    // The node's quote subscription follows the account, the selected market and the markets held; a
    // request the node refused (an account not yet credited) is sent again once the account is credited.
    let key = "";
    const sync = () => {
      const next = quoteSyncKey(store.getSnapshot());
      if (next === key) return;
      key = next;
      syncQuotes(store);
    };
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      store.deps.client.quotes(null);
    };
  }, [store, session.node]);
  return <SessionContext value={session}><Fragment key={session.moves}>{children}</Fragment></SessionContext>;
}

/** The session. Throws outside the provider. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession is used outside ConsoleProvider");
  return session;
}

const NO_FOLLOW = () => () => {};

/** What the console knows of the node it should talk to; null for the mock, whose node is in this page. */
export function useNodeFollow(): FollowStatus | null {
  const { follower } = useSession();
  const read = () => follower?.getSnapshot() ?? null;
  return useSyncExternalStore(follower?.subscribe ?? NO_FOLLOW, read, read);
}

/** The console's state, re-rendering on every change. */
export function useConsole(): ConsoleState {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * A value derived from the console's state, re-rendering only when it changes by `Object.is`: `select` returns a primitive or
 * something the state keeps, so a screen that shows a clock to the minute is not redrawn by every tick.
 */
export function useConsoleValue<T>(select: (state: ConsoleState) => T): T {
  const { store } = useSession();
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()), () => select(store.getSnapshot()));
}
