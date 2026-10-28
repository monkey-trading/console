/** The console's store: reads the node, follows its stream, and notifies the screens. */

import { pushMark } from "../candles";
import { checkAttestation } from "../engine/attestation";
import { EngineError, type EngineClient } from "../engine/client";
import type { HouseView, MarketId, MarketView, StreamMessage } from "../engine/types";
import type { Wallet, WalletConnector } from "../engine/wallet";
import { fixedToNumber } from "../fixed";
import { describeEvent } from "../messages";
import { decodeAccount, decodeHouse, decodeMarket } from "../models";
import { initialState, seedAllCandles, type BlockReason, type ChartMode, type ConsoleState, type ToastMessage } from "./state";

/** The address the access probe reads, since the node screens the caller, not the account. */
const PROBE_ADDRESS = "0x0000000000000000000000000000000000000000";
const FEED_LIMIT = 40;

export interface StoreDeps {
  client: EngineClient;
  wallets: WalletConnector;
  /** Advances a node that runs in this page; absent for a live node. */
  drive?: (ms: number) => void;
  initial: { markets: MarketView[]; house: HouseView; startMs: number };
}

export class ConsoleStore {
  readonly deps: StoreDeps;
  /** The connected wallet, which holds a signer and so is not part of the snapshot. */
  liveWallet: Wallet | null = null;
  private snapshot: ConsoleState;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private inflight: Promise<void> | null = null;
  /** A refresh asked for while one ran: its answer may predate the change, so it reads again. */
  private rerun: { accountChanged: boolean } | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.snapshot = initialState(deps.initial.markets, deps.initial.house, deps.initial.startMs);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ConsoleState => this.snapshot;

  patch(partial: Partial<ConsoleState>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  id(): number {
    return this.nextId++;
  }

  toast(tone: ToastMessage["tone"], text: string): void {
    this.patch({ toasts: [...this.snapshot.toasts.slice(-3), { id: this.id(), tone, text }] });
  }

  clearToasts(): void {
    this.patch({ toasts: [] });
  }

  dismissToast(id: number): void {
    this.patch({ toasts: this.snapshot.toasts.filter((t) => t.id !== id) });
  }

  select(id: MarketId): void {
    this.patch({ selected: id });
  }

  setFundingOpen(open: boolean): void {
    this.patch({ fundingOpen: open });
  }

  setMode(mode: ChartMode): void {
    this.patch({ mode });
  }

  /** Marks the caller as refused when `error` is an access refusal; true if it was. */
  noteAccess(error: unknown): boolean {
    if (error instanceof EngineError && error.reject?.type === "access") {
      const reason = error.reject.reason;
      if (reason === "united_states" || reason === "sanctioned_jurisdiction") {
        this.patch({ blocked: reason satisfies BlockReason });
        return true;
      }
    }
    return false;
  }

  /**
   * Starts following the node at `nowMs`: checks its attestation and access, redraws the charts
   * from that instant, and subscribes to the stream.
   */
  start(nowMs: number): () => void {
    this.deps.drive?.(nowMs);
    this.patch({ now: nowMs, candles: seedAllCandles(this.snapshot.markets, nowMs) });
    this.unsubscribe = this.deps.client.subscribe((message) => this.onMessage(message));
    void this.checkNode();
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
    };
  }

  /** Advances a node that runs in this page. */
  tick(nowMs: number): void {
    this.deps.drive?.(nowMs);
  }

  /** Reads the attestation and probes access. Run at start and after a change of region. */
  async checkNode(): Promise<void> {
    try {
      const attestation = await this.deps.client.attestation();
      this.patch({ attestation: checkAttestation(attestation) });
    } catch (error) {
      this.patch({ attestation: { kind: "unverified", reason: error instanceof Error ? error.message : "The attestation could not be read." } });
    }
    try {
      await this.deps.client.eligibility(PROBE_ADDRESS);
      this.patch({ blocked: null });
    } catch (error) {
      if (!this.noteAccess(error)) this.toast("error", "The node did not answer the access check.");
    }
  }

  private onMessage(message: StreamMessage): void {
    const lines = message.events.flatMap((event) => {
      const text = describeEvent(event, (id) => this.snapshot.markets.find((m) => m.id === id)?.symbol ?? `market ${id}`);
      return text === null ? [] : [{ id: this.id(), ts: message.ts, text }];
    });
    this.patch({ now: message.ts, feed: [...lines.reverse(), ...this.snapshot.feed].slice(0, FEED_LIMIT) });
    if (message.cmd.type === "tick") void this.refresh(message.events.some((e) => "account" in e));
  }

  /**
   * Re-reads markets, house, and the connected account. A call made while one runs waits for it and
   * then reads again, since the running read may predate the change that prompted the call.
   */
  refresh(accountChanged: boolean): Promise<void> {
    if (this.inflight) {
      this.rerun = { accountChanged: accountChanged || (this.rerun?.accountChanged ?? false) };
      return this.inflight;
    }
    const run = this.readAll(accountChanged).finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async readAll(accountChanged: boolean): Promise<void> {
    try {
      const [views, house] = await Promise.all([this.deps.client.markets(), this.deps.client.house()]);
      const markets = views.map((view) => decodeMarket(view, this.snapshot.markets.find((m) => m.id === view.id)));
      const candles = { ...this.snapshot.candles };
      for (const m of markets) if (m.mark !== null && m.open) candles[m.id] = pushMark(candles[m.id] ?? [], this.snapshot.now, fixedToNumber(m.mark));
      this.patch({ markets, candles, house: decodeHouse(house) });
      if (this.snapshot.wallet) await this.loadAccount(accountChanged);
    } catch (error) {
      if (!this.noteAccess(error)) this.toast("error", error instanceof Error ? error.message : "The node did not answer.");
    }
    const again = this.rerun;
    this.rerun = null;
    if (again) await this.readAll(again.accountChanged);
  }

  /** Reads the connected account's state; a never-credited account is an empty one. */
  async loadAccount(withHistory: boolean): Promise<void> {
    const wallet = this.snapshot.wallet;
    if (!wallet) return;
    const { client } = this.deps;
    const [eligibility, queue] = await Promise.all([client.eligibility(wallet.address), client.withdrawalQueue(wallet.address)]);
    let account = null;
    try {
      account = decodeAccount(await client.account(wallet.address));
    } catch (error) {
      if (!(error instanceof EngineError && error.status === 404)) throw error;
    }
    this.patch({ eligibility: eligibility.class, queue: queue.queue, account });
    if (withHistory || this.snapshot.history.length === 0) {
      this.patch({ history: (await client.history(wallet.address, { limit: 100 })).events });
    }
  }
}
