/** Tests for how the store follows a live client's trust and feed. */

import { describe, expect, it } from "vitest";

import { signBlock } from "../engine/attestation";
import { LiveEngineClient } from "../engine/live";
import { acceptAll, FakeNode, FakeScheduler, FakeSocket, mockAttestation, settle } from "../engine/test-kit";
import { realVerifier, VECTORS, vectorResponse } from "../engine/test-vectors";
import type { StreamMessage } from "../engine/types";
import { WatchConnector } from "../engine/watch-wallet";
import { fixedFromWire } from "../fixed";
import { cancelOrder, connectWallet, deposit } from "./actions";
import { ConsoleStore } from "./store";
import { ACCOUNT, BTC, setup } from "./live-fake";

describe("a live client's trust and feed", () => {
  it("loads markets once the node is trusted, and starts with nothing on screen and the feed connecting", async () => {
    const { client, store } = setup();
    expect(store.getSnapshot()).toMatchObject({ markets: [], stream: "connecting", signatures: "checked" });
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
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBe("the node's feed has not started yet");
    client.listener?.({ type: "feed", status: "live" });
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBeNull();
    client.listener?.({ type: "feed", status: "stale" });
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBe("the node's feed is stale");
    client.listener?.({ type: "feed", status: "live" });
    expect(signBlock(store.getSnapshot().attestation, store.getSnapshot().stream)).toBeNull();
  });

  it("shows the session as re-verifying, and reads nothing again when the same enclave is trusted", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    client.listener?.({ type: "attestation", status: { kind: "reverifying" } });
    expect(store.getSnapshot().attestation.kind).toBe("reverifying");
    client.listener?.({ type: "attestation", status: { kind: "mock" } });
    await settle();
    expect(store.getSnapshot().attestation.kind).toBe("mock");
    expect(client.marketReads).toBe(1);
  });

  it("reads everything again when another enclave is trusted, or after trust returns from a clock error or a failed check, whatever states it passes through", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    client.listener?.({ type: "enclave" });
    await settle();
    expect(client.marketReads).toBe(2);
    for (const was of [{ kind: "clock", skewMs: 60_000 }, { kind: "unverified", reason: "x" }] as const) {
      client.listener?.({ type: "attestation", status: was });
      client.listener?.({ type: "attestation", status: { kind: "checking" } });
      client.listener?.({ type: "attestation", status: { kind: "mock" } });
      await settle();
    }
    expect(client.marketReads).toBe(4);
  });

  it("reads again when the feed first connects and when it returns from a failure, and not when it stays live", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.marketReads).toBe(2);
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.marketReads).toBe(2);
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.marketReads).toBe(3);
  });

  it("decodes a live node's markets without the mock's base spread", async () => {
    const { store } = setup();
    store.start(0);
    await settle();
    expect(store.getSnapshot().markets[0]?.baseSpreadBps).toBe(0);
  });

  it("refreshes the watched account's history for an event of its own from any command, and for no other account's", async () => {
    const { client, store } = setup();
    let histories = 0;
    client.history = async () => { histories++; return { events: [], next: null }; };
    store.start(0);
    await settle();
    await connectWallet(store, "watch", true);
    const base = histories;
    const event = (account: string) => ({ type: "deposited", account, amount: "5" }) as unknown as StreamMessage["events"][number];
    const message = (type: string, account: string): StreamMessage => ({ offset: "9:0", type: "command", seq: 9, ts: 1, cmd: { type } as StreamMessage["cmd"], events: [event(account)] });
    client.onMessage?.(message("deposit", "0xabc0000000000000000000000000000000000001"));
    await settle();
    expect(histories).toBe(base);
    client.onMessage?.(message("deposit", ACCOUNT.toUpperCase().replace("0X", "0x")));
    await settle();
    expect(histories).toBe(base + 1);
  });

  it("reads once, not twice, when a new enclave is trusted after trust was lost, or a wrong clock is corrected while the feed is stale", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    client.listener?.({ type: "attestation", status: { kind: "unverified", reason: "x" } });
    client.listener?.({ type: "enclave" });
    client.listener?.({ type: "attestation", status: { kind: "mock" } });
    await settle();
    expect(client.marketReads).toBe(2);
    client.listener?.({ type: "feed", status: "stale" });
    client.listener?.({ type: "attestation", status: { kind: "clock", skewMs: 60_000 } });
    client.listener?.({ type: "attestation", status: { kind: "mock" } });
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(client.marketReads).toBe(3);
  });

  it("shows a read failure that repeats on every tick once, and again after a read succeeds", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    const markets = client.markets.bind(client);
    client.markets = async () => { throw new Error("The node's answer did not verify: x."); };
    for (let i = 0; i < 3; i++) await store.refresh(false);
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("did not verify"))).toHaveLength(1);
    client.markets = markets;
    await store.refresh(false);
    client.markets = async () => { throw new Error("The node's answer did not verify: x."); };
    await store.refresh(false);
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("did not verify"))).toHaveLength(2);
  });

  it("selects the first listed market when the selected one is not listed, and builds bars for a market first seen after the node's clock is known", async () => {
    const { client, store } = setup();
    client.markets = async () => [{ ...BTC, id: 2, symbol: "ETH-USD" }];
    store.start(0);
    await settle();
    expect(store.getSnapshot().selected).toBe(2);
    expect(store.getSnapshot().bars[2]?.["1m"]).toEqual([]);
    client.onMessage?.({ offset: "1:0", type: "command", seq: 1, ts: 1_800_000_000_000, cmd: { type: "tick" }, events: [] });
    client.markets = async () => [{ ...BTC, id: 2, symbol: "ETH-USD" }, { ...BTC, id: 3, symbol: "SOL-USD", mark: "200" }];
    await store.refresh(false);
    expect(store.getSnapshot().bars[3]?.["1m"]).toHaveLength(1);
    expect(store.getSnapshot().bars[3]?.["1m"]?.[0]?.close).toBe(200);
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

  it("says why it will not sign an action while the feed is stale", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    await connectWallet(store, "watch", true);
    // A wallet that can sign, so the feed is the cause under test; the read-only account has its own tests.
    store.patch({ wallet: { address: ACCOUNT, label: "Test wallet" } });
    client.listener?.({ type: "feed", status: "stale" });
    await cancelOrder(store, 1);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The console will not sign: the node's feed is stale.");
  });

  it("says why it will not send a deposit while the feed is stale", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    await connectWallet(store, "watch", true);
    // A wallet that can sign, so the feed is the cause under test; the read-only account has its own tests.
    store.patch({ wallet: { address: ACCOUNT, label: "Test wallet" } });
    client.listener?.({ type: "feed", status: "stale" });
    await deposit(store, 10n);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The console will not send a deposit: the node's feed is stale.");
  });
});

describe("a live client that keeps failing its signature checks", () => {
  it("reads once and shows the refusal, without reading again by itself", async () => {
    const node = new FakeNode();
    node.attestation(() => VECTORS.signer);
    const market = vectorResponse("markets");
    node.signed("/v1/markets", () => ({ status: 200, body: market.body, signature: market.signature, timeMs: market.time_ms, seq: market.head_seq }));
    node.signed("/v1/house", () => ({ status: 200, body: "{}", signature: market.signature, timeMs: market.time_ms, seq: 1 }));
    const verifier = await realVerifier();
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 1, vault: market.vault, heartbeatMs: 5_000, loadVerifier: async () => verifier,
      manifests: [], acceptsMock: true, fetch: node.fetch, openSocket: () => new FakeSocket("wss://node.test"), scheduler: new FakeScheduler(), nowMs: () => market.time_ms,
    });
    const store = new ConsoleStore({ client: live, wallets: new WatchConnector(() => ""), history: () => [], initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
    store.start(0);
    for (let i = 0; i < 20; i++) await settle();
    expect(node.requests.filter((r) => r.path === "/v1/markets")).toHaveLength(1);
    expect(store.getSnapshot().markets).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toContain("did not verify");
  });
});

describe("a live node that is down at first", () => {
  it("loads markets once the stream's retry finds it trusted, through the real event sequence", async () => {
    const node = new FakeNode();
    let up = false;
    node.routes.set("/v1/attestation", () => (up ? new Response(mockAttestation(VECTORS.signer)) : new Response("", { status: 503 })));
    const signed = (body: unknown) => ({ status: 200, body: JSON.stringify(body), signature: "0x", timeMs: 1, seq: 1 });
    node.signed("/v1/markets", () => signed([BTC]));
    node.signed("/v1/house", () => signed({ cash: "1", nav: "1", gross_exposure: "0" }));
    const scheduler = new FakeScheduler();
    const sockets: FakeSocket[] = [];
    const live = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: ACCOUNT, heartbeatMs: 5_000, loadVerifier: async () => acceptAll,
      manifests: [], acceptsMock: true, fetch: node.fetch, openSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; }, scheduler, nowMs: () => 1,
    });
    const store = new ConsoleStore({ client: live, wallets: new WatchConnector(() => ""), history: () => [], initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
    store.start(0);
    await settle();
    expect(store.getSnapshot().attestation.kind).toBe("unverified");
    expect(store.getSnapshot().markets).toEqual([]);
    up = true;
    scheduler.advance(1_000);
    for (let i = 0; i < 20; i++) await settle();
    expect(store.getSnapshot().attestation.kind).toBe("mock");
    // The stream's first frame returns the feed from stale, which reads everything once.
    sockets.at(-1)?.receive(JSON.stringify({ v: 1, n: 0, time: 1, msg: '{"type":"heartbeat","head":null}', sig: "0x" }));
    for (let i = 0; i < 20; i++) await settle();
    expect(store.getSnapshot().markets.map((m) => m.symbol)).toEqual(["BTC-USD"]);
  });
});
