/**
 * The Settings page's list of the account's live session keys (monkey-trading/console#169), read
 * from the public history route: when the page opens, when the stream says a key was registered or
 * revoked for the account, and once a minute otherwise. The read asks the wallet for nothing and
 * needs no session key. Held apart from the console's store, so a stream message re-renders nothing
 * that shows it.
 */

import { signBlock } from "../engine/attestation";
import { EngineError } from "../engine/client";
import { revokeSessionKeyTypedData } from "../engine/eip712";
import type { Scheduler } from "../engine/live-stream";
import type { StreamMessage } from "../engine/types";
import { readLiveKeys, type LiveKey } from "../live-keys";
import { describeReject } from "../messages";
import { shortHex } from "../format";
import { liveSessionKey } from "./session";
import { domainOf, errorText, signed } from "./signing";
import type { ConsoleStore } from "./store";
import { sessionEnded } from "./wallet-session";

/** How often the list is read when nothing tells the page it changed: the node signs every answer, so this is slow. */
export const SESSION_REFRESH_MS = 60_000;

/** Why the list cannot be shown, or that it can. */
export type SessionListStatus =
  | { kind: "no-wallet" }
  /** The console cannot read the node now, for a reason the page names. */
  | { kind: "waiting"; why: string }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

export interface SessionListState {
  status: SessionListStatus;
  /** The live keys the last read found, newest start first. */
  keys: readonly LiveKey[];
  /** This browser's key, if one is live: the row to mark. */
  ownKey: string | null;
  /** The key whose revocation is in flight. */
  revoking: string | null;
  /** Whether a read is in flight. */
  reading: boolean;
  /** False when the read stopped short of the 24 hours it needs, so the list may miss a key. */
  complete: boolean;
}

const INITIAL: SessionListState = { status: { kind: "no-wallet" }, keys: [], ownKey: null, revoking: null, reading: false, complete: true };

const browserScheduler: Scheduler = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  // The handle is the one this scheduler's own setTimeout returned.
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class SessionList {
  private state: SessionListState = INITIAL;
  private readonly listeners = new Set<() => void>();
  /** The wallet, status and key the last sync saw: a read starts when they change, not on every store change. */
  private gate = "";
  private timer: unknown = null;
  private reading = false;
  /** A read asked for while one ran. */
  private again = false;
  private active = false;
  /** Counts opens and closes, so a read that outlived its page drops its answer. */
  private session = 0;
  /** Set when the minute timer fired in a hidden tab, so the tab's return reads once. */
  private paused = false;

  /** `hidden` says whether the page's tab is hidden: the minute timer reads nothing then. */
  constructor(private readonly store: ConsoleStore, private readonly hidden: () => boolean, private readonly scheduler: Scheduler = browserScheduler) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SessionListState => this.state;

  /** Starts following the account while the page is open, and reads the list now. Returns the stop. */
  open(): () => void {
    this.session += 1;
    this.active = true;
    const stopStore = this.store.subscribe(() => this.sync());
    const stopStream = this.store.deps.client.subscribe((message) => this.onMessage(message));
    this.gate = "";
    this.sync();
    return () => {
      this.session += 1;
      this.active = false;
      stopStore();
      stopStream();
      this.stopTimer();
    };
  }

  /** The page's tab is visible again: reads once if the minute timer fired while it was hidden. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.mayRead()) void this.read();
  }

  /** Reads the list now. */
  refresh(): Promise<void> {
    return this.read();
  }

  /**
   * Revokes `address` with one wallet signature. The row goes at the node's `session_key_revoked`; revoking this browser's own key
   * ends this session too.
   */
  async revoke(address: string): Promise<void> {
    const { store } = this;
    const wallet = store.liveWallet;
    if (wallet === null || this.state.revoking !== null) return;
    const own = this.state.ownKey?.toLowerCase() === address.toLowerCase();
    this.patch({ revoking: address });
    try {
      const out = await signed(store, `revoke the trading authorization of session key ${shortHex(address)}`, (terms, account) => revokeSessionKeyTypedData(domainOf(store), account, address, terms), (auth, signer) =>
        store.deps.client.revokeSessionKey({ account: signer.address, session_key: address, auth }), "sign-again");
      if (!out.ok || store.liveWallet !== wallet) return;
      const refused = out.result.events.find((e) => e.type === "session_key_rejected");
      if (refused && refused.type === "session_key_rejected") {
        store.toast("error", describeReject(refused.reason));
      } else if (out.result.events.some((e) => e.type === "session_key_revoked")) {
        this.patch({ keys: this.state.keys.filter((k) => k.address !== address.toLowerCase()) });
        // The stream's copy of this revocation may already have ended the session, in which case this does nothing.
        if (own) return sessionEnded(store, "You revoked this browser's trading authorization, so the console disconnected the wallet.");
        store.toast("ok", `Session key ${shortHex(address)} revoked.`);
      }
      if (this.mayRead()) void this.read();
    } finally {
      this.patch({ revoking: null });
    }
  }

  private patch(partial: Partial<SessionListState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  /** What stands between the page and a read, from the store's state. Runs on every store change, so it only compares. */
  private statusNow(): SessionListStatus {
    const snapshot = this.store.getSnapshot();
    if (snapshot.wallet === null) return { kind: "no-wallet" };
    const blocked = signBlock(snapshot.attestation, snapshot.stream, false);
    return blocked === null ? { kind: "loading" } : { kind: "waiting", why: blocked };
  }

  /** Whether a read may start or go on: the page is open and the node can be read now. Every step after an await asks again. */
  private mayRead(): boolean {
    return this.active && this.statusNow().kind === "loading";
  }

  /** Reacts to a change of the wallet, the key or the node's trust: a read starts when the page can first make one. */
  private sync(): void {
    const status = this.statusNow();
    const account = this.store.getSnapshot().wallet?.address.toLowerCase() ?? "";
    const ownKey = liveSessionKey(this.store)?.address ?? null;
    const gate = `${account}|${status.kind}|${status.kind === "waiting" ? status.why : ""}|${ownKey ?? ""}`;
    if (gate === this.gate) return;
    const accountChanged = account !== this.gate.split("|")[0];
    this.gate = gate;
    // Keys read for another account are not shown.
    const forgotten = accountChanged ? { keys: [] } : {};
    if (status.kind === "loading") {
      this.patch({ ownKey, ...forgotten });
      void this.read();
      return;
    }
    this.stopTimer();
    this.patch({ status, ownKey, ...forgotten });
  }

  private onMessage(message: StreamMessage): void {
    const account = this.store.getSnapshot().wallet?.address.toLowerCase();
    if (account === undefined) return;
    for (const event of message.events) {
      if ((event.type !== "session_key_registered" && event.type !== "session_key_revoked") || event.account.toLowerCase() !== account) continue;
      // A revocation of this browser's own key has already ended the connection, on every page, in the store (`noteSessionRevoked`), so no read starts.
      if (this.mayRead()) void this.read();
      return;
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.stopTimer();
    if (!this.active) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (this.hidden()) this.paused = true;
      else if (this.mayRead()) void this.read();
    }, SESSION_REFRESH_MS);
  }

  /** One read; a call made while one runs waits, then reads again. */
  private async read(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return;
    }
    if (!this.mayRead()) return;
    this.reading = true;
    const { store } = this;
    const { session } = this;
    const wallet = store.liveWallet;
    const account = store.getSnapshot().wallet?.address;
    try {
      if (wallet === null || account === undefined) return;
      // Loading shows only before any answer: a list or a failure on screen stays until the next one replaces it.
      this.patch({ reading: true, ...(this.state.status.kind === "ready" || this.state.status.kind === "failed" ? {} : { status: { kind: "loading" } }) });
      const { keys, complete } = await readLiveKeys((params) => store.deps.client.history(account, params), store.getSnapshot().now, () => this.stale(session, wallet));
      if (this.stale(session, wallet)) return;
      this.patch({ keys, complete, status: { kind: "ready" } });
    } catch (error) {
      if (this.stale(session, wallet) || store.noteAccess(error)) return;
      // An account the node has never credited has no keys, and says so with a 404.
      if (error instanceof EngineError && error.status === 404) this.patch({ keys: [], complete: true, status: { kind: "ready" } });
      else this.patch({ status: { kind: "failed", message: errorText(error) } });
    } finally {
      this.reading = false;
      this.patch({ reading: false });
      if (this.mayRead()) this.schedule();
      if (this.again) {
        this.again = false;
        if (this.mayRead()) void this.read();
      }
    }
  }

  /** Whether the page closed, the wallet changed or the node became unreadable while this read waited, so its answer is not for this page now. */
  private stale(session: number, wallet: unknown): boolean {
    return this.session !== session || this.store.liveWallet !== wallet || !this.mayRead();
  }
}
