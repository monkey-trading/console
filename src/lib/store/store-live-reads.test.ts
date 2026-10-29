/** Tests for what a live store reports, reads and shows around a read-only account, a node outage and the stream's recovery. */

import { describe, expect, it } from "vitest";

import { settle } from "../engine/test-kit";
import { UntrustedError } from "../engine/trust";
import type { StreamMessage } from "../engine/types";
import { cancelOrder, connectWallet, deposit } from "./actions";
import { BTC, setup } from "./live-fake";

const tick = (ts: number): StreamMessage => ({ offset: "1:0", type: "command", seq: 1, ts, cmd: { type: "tick" } as StreamMessage["cmd"], events: [] });

describe("a read-only account", () => {
  it("is marked read-only, and an action names that as the cause without reading a nonce", async () => {
    const { client, store } = setup();
    let nonces = 0;
    client.nonce = async () => { nonces++; return { next_nonce: 0 }; };
    store.start(0);
    await settle();
    await connectWallet(store, "watch", true);
    client.listener?.({ type: "feed", status: "live" });
    expect(store.getSnapshot().wallet?.readOnly).toBe(true);
    await cancelOrder(store, 1);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The console will not sign: this account is read-only, so nothing can be signed for it.");
    await deposit(store, 10n);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The console will not send a deposit: this account is read-only, so nothing can be signed for it.");
    expect(nonces).toBe(0);
  });
});

describe("a node outage at load", () => {
  it("is not reported again by the account read that waits on the same trust check", async () => {
    const { client, store } = setup();
    client.eligibility = async () => { throw new UntrustedError("The node is not verified."); };
    store.start(0);
    await settle();
    await connectWallet(store, "watch", true);
    expect(store.getSnapshot().toasts).toEqual([]);
  });

  it("still reports a wallet that fails to connect for another reason", async () => {
    const { client, store } = setup();
    client.eligibility = async () => { throw new Error("The node did not answer."); };
    await connectWallet(store, "watch", true);
    expect(store.getSnapshot().toasts.map((t) => t.text)).toEqual(["The node did not answer."]);
  });
});

describe("the stream's first frame", () => {
  it("reads the account and its history once, for an event between the first reads and the stream's start", async () => {
    const { client, store } = setup();
    let histories = 0;
    client.history = async () => { histories++; return { events: [], next: null }; };
    store.start(0);
    await settle();
    await connectWallet(store, "watch", true);
    const base = histories;
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(histories).toBe(base + 1);
    client.listener?.({ type: "feed", status: "live" });
    await settle();
    expect(histories).toBe(base + 1);
  });
});

describe("a recovery led by a heartbeat", () => {
  it("plots the recovered mark at the heartbeat's node time, leaving the pre-outage candle as it was", async () => {
    const { client, store } = setup();
    store.start(0);
    await settle();
    const before = Date.UTC(2026, 9, 29, 12, 0, 30);
    client.onMessage?.(tick(before));
    await settle();
    client.listener?.({ type: "feed", status: "live", time: before });
    client.listener?.({ type: "feed", status: "stale" });
    client.markets = async () => [{ ...BTC, mark: "200000" }];
    const after = before + 10 * 60_000;
    client.listener?.({ type: "feed", status: "live", time: after });
    await settle();
    const bars = store.getSnapshot().bars[1]?.["1m"] ?? [];
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ time: Math.floor(before / 60_000) * 60, close: 100_000 });
    expect(bars[1]).toMatchObject({ time: Math.floor(after / 60_000) * 60, close: 200_000 });
    expect(store.getSnapshot().now).toBe(after);
  });
});
