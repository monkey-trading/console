/** What the session's two builders share: its shape, the browser's timers and storage, and the preferences kept in this browser. */

import type { Deploy } from "@/lib/engine/deploy";
import type { OperatorFollower } from "@/lib/engine/operator-follow";
import type { Eip1193Provider } from "@/lib/engine/provider-wallet";
import type { WalletConnectConnector } from "@/lib/engine/walletconnect";
import type { MockNode } from "@/lib/mock";
import { PREFS_KEY, SIZES_KEY } from "@/lib/prefs";
import { PrefsStore } from "@/lib/prefs-store";
import type { MoveAnnouncer } from "@/lib/store/node-move";
import type { ConsoleStore } from "@/lib/store/store";

export interface Session {
  store: ConsoleStore;
  /** The deployment this build pins; what the faucet gates on, among the rest. */
  deploy: Deploy;
  /** The in-browser node; null when the console talks to a live one. */
  node: MockNode | null;
  /** The WalletConnect connector, whose pairing link the pairing dialog shows; null when the build has none. */
  walletConnect: WalletConnectConnector | null;
  /** The trading preferences kept in this browser, apart from the store so a stream message re-renders nothing that reads them. */
  prefs: PrefsStore;
  /** Which node a live session should talk to, from the chain; null for the mock. */
  follower: OperatorFollower | null;
  /** Counts the moves to another node, each of which remounts every screen on a fresh store. */
  moves: number;
  /** Posts the move notice at most once per move and holds its dismissal for that move alone. */
  announcer: MoveAnnouncer;
  /** Hears each move to another node, which brings a fresh store; absent for the mock, which has one node. */
  onMove?: (listener: (store: ConsoleStore) => void) => void;
}


/** The browser's timers; a handle is the one this scheduler's own setTimeout returned. */
export const scheduler = { setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
/** The browser's storage for the account's exit proof, reached only from effects and handlers; it throws where the browser denies it. */
export const exitStorage = () => window.localStorage;

/** The page's injected EIP-1193 provider, when a browser wallet put one there. */
export function injectedProvider(): Eip1193Provider | undefined {
  // EIP-1193 providers sit at `window.ethereum`, which the DOM types do not declare.
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

/** The preferences over `localStorage`, which is reached only from effects and handlers, never in the server render; another tab's write is heard through the `storage` event. */
export function createPrefs(): PrefsStore {
  return new PrefsStore(() => window.localStorage, (onChange) => {
    const heard = (event: StorageEvent) => { if (event.key === null || event.key === PREFS_KEY || event.key === SIZES_KEY) onChange(); };
    window.addEventListener("storage", heard);
    return () => window.removeEventListener("storage", heard);
  });
}

