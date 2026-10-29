/** Tests for how the store follows a live client's trust and feed. */

import { describe, expect, it } from "vitest";

import { EngineError, type ClientEvent, type EngineClient } from "../engine/client";
import type { MarketView, StreamMessage } from "../engine/types";
import { fixedFromWire } from "../fixed";
import { WatchConnector } from "../engine/watch-wallet";
import { settle } from "../engine/test-kit";
import { ConsoleStore } from "./store";
import { signBlock } from "../engine/attestation";

const BTC: MarketView = {
  id: 1, symbol: "BTC-USD", open: true, reduce_only: false, mark: "100000", fx_mark: null, stress_level: 0,
} as unknown as MarketView;
const ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

/** A client with canned reads and a handle to push its events and stream messages. */
class FakeClient implements EngineClient {
  signatures = "unchecked" as const;
  listener: ((event: ClientEvent) => void) | null = null;
  onMessage: ((message: StreamMessage) => void) | null = null;
  marketReads = 0;
  accountError: Error | null = null;
  status: Awaited<ReturnType<EngineClient["verify"]>> = { kind: "mock" };
  async attestation(): Promise<never> { throw new Error("unused"); }
  async verify() { return this.status; }
  watch(listener: (event: ClientEvent) => void) { this.listener = listener; return () => { this.listener = null; }; }
  async markets() { this.marketReads++; return [BTC]; }
  async house() { return { cash: "5", nav: "5", gross_exposure: "0" }; }
  async account(): Promise<never> { throw this.accountError ?? new EngineError(404, "not found"); }
  async accessProbe() {}
  async nonce() { return { next_nonce: 0 }; }
  async eligibility() { return { class: null, statement: null }; }
  async attestEligibility(): Promise<never> { throw new EngineError(501, "no"); }
  async placeOrder(): Promise<never> { throw new EngineError(501, "no"); }
  async cancelOrder(): Promise<never> { throw new EngineError(501, "no"); }
  async withdraw(): Promise<never> { throw new EngineError(501, "no"); }
  async withdrawalQueue() { return { seq: 1, queue: [], next: null }; }
  async history() { return { events: [], next: null }; }
  subscribe(onMessage: (message: StreamMessage) => void) { this.onMessage = onMessage; return () => { this.onMessage = null; }; }
}

function setup() {
  const client = new FakeClient();
  const store = new ConsoleStore({
    client, wallets: new WatchConnector(() => `?account=${ACCOUNT}`), history: () => [],
    initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
  });
  return { client, store };
}

describe("a live client's trust and feed", () => {
  it("loads markets once the node is trusted, and starts with nothing on screen and the feed connecting", async () => {
    const { client, store } = setup();
    expect(store.getSnapshot()).toMatchObject({ markets: [], stream: "connecting", signatures: "unchecked" });
    store.start(0);
    await settle();
    const state = store.getSnapshot();
    expect(client.marketReads).toBe(1);
    expect(state.attestation).toEqual({ kind: "mock" });
    expect(state.markets.map((m) => m.symbol)).toEqual(["BTC-USD"]);
    expect(state.markets[0]?.mark).toBe(fixedFromWire("100000"));
    expect(state.house.cash).toBe(fixedFromWire("5"));
    expect(state.bars[1]?.["1m"]).toEqual([]);
  });

  it("reads nothing from a node it does not trust", async () => {
    const { client, store } = setup();
    client.status = { kind: "unverified", reason: "no" };
    store.start(0);
    await settle();
    expect(client.marketReads).toBe(0);
    expect(store.getSnapshot().markets).toEqual([]);
  });

  it("disables signing while the feed is stale and enables it when the feed recovers", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBe("Waiting for the node's feed.");
    client.listener?.({ type: "feed", status: "live" });
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBeNull();
    client.listener?.({ type: "feed", status: "stale" });
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toContain("stale");
    client.listener?.({ type: "feed", status: "live" });
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBeNull();
  });

  it("shows the session as re-verifying, then reads everything again once the new enclave is trusted", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    client.listener?.({ type: "attestation", status: { kind: "reverifying" } });
    expect(store.getSnapshot().attestation.kind).toBe("reverifying");
    expect(client.marketReads).toBe(1);
    client.listener?.({ type: "attestation", status: { kind: "mock" } });
    await settle();
    expect(store.getSnapshot().attestation.kind).toBe("mock");
    expect(client.marketReads).toBe(2);
  });

  it("tells the user why the stream was dropped", async () => {
    const { client, store } = setup();
    store.start(0);
    client.listener?.({ type: "problem", reason: "The stream skipped from frame 0 to 2." });
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "The stream skipped from frame 0 to 2." });
  });

  it("shows an untrusted answer as an error, never as data", async () => {
    const { client, store } = setup();
    client.markets = async () => { throw new Error("The node's answer did not verify: wrong_signer."); };
    store.start(0);
    await settle();
    expect(store.getSnapshot().markets).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("did not verify");
  });
});
