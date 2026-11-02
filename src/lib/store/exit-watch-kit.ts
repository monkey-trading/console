/** Tests only: a store whose watch follows a fake vault and fake timers, with a connected account. */

import { exitStorage, ACCOUNT, FakeExitWallet, fullProof, SCOPE } from "../engine/exit-kit";
import type { ClientEvent } from "../engine/client";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import type { ExitFollowDeps } from "./exit";
import { FakeClient } from "./live-fake";
import { ConsoleStore } from "./store";

/** Timers a test runs by hand, in the order they would fire. */
export class FakeTimers {
  now = 0;
  timers: { at: number; run: () => void }[] = [];
  setTimeout = (run: () => void, ms: number): unknown => { const timer = { at: this.now + ms, run }; this.timers.push(timer); return timer; };
  clearTimeout = (handle: unknown): void => { this.timers = this.timers.filter((t) => t !== handle); };
  async pass(ms: number): Promise<void> {
    const end = this.now + ms;
    for (let due = this.next(end); due !== undefined; due = this.next(end)) {
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.run();
      await settle();
    }
    this.now = end;
  }
  private next(end: number) {
    return [...this.timers].sort((a, b) => a.at - b.at).find((t) => t.at <= end);
  }
}

/** A store over a fake client and wallet, its node answering `fullProof(100)` and its vault at checkpoint 100, with nothing connected yet. */
export function exitWatchKit() {
  const client = new FakeClient();
  let listeners: ((event: ClientEvent) => void)[] = [];
  client.watch = (listener) => { listeners.push(listener); return () => { listeners = listeners.filter((l) => l !== listener); }; };
  client.deployment = { chainId: 31337, vault: SCOPE.vault };
  client.exitAnswer = fullProof(100);
  const exit = new FakeExitWallet();
  const storage = exitStorage();
  let denied = false;
  const timers = new FakeTimers();
  const wallet: Wallet = { address: ACCOUNT, label: "Test", exit, sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, exitStorage: () => { if (denied) throw new Error("denied"); return storage; }, history: () => [], initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  const kit = {
    client, exit, storage, timers, wallet, store,
    hidden: false,
    /** Makes the browser refuse every use of its storage. */
    denyStorage: () => { denied = true; },
    deps: (): ExitFollowDeps => ({ scheduler: timers, hidden: () => kit.hidden, nowMs: () => timers.now }),
    emit: (event: ClientEvent) => { for (const listener of listeners) listener(event); },
    /** Connects `wallet` with the watch following and the node as `state` says. */
    async attach(state: Parameters<ConsoleStore["patch"]>[0] = {}, connected: Wallet = wallet): Promise<void> {
      store.exit.follow(kit.deps());
      store.patch(state);
      store.liveWallet = connected;
      store.patch({ wallet: { address: ACCOUNT, label: "Test", ...(connected.readOnly ? { readOnly: true } : {}) } });
      await settle();
    },
    /** A connected account the page has read as holding `balance`, on a trusted, live node. */
    connect(balance = 1000n): Promise<void> {
      return kit.attach({ attestation: { kind: "mock" }, stream: "live", accountRead: true, account: balance === 0n ? null : { balance, unfinalised: 0n, equity: balance, margin: 0n, positions: [], orders: [] } });
    },
  };
  return kit;
}
