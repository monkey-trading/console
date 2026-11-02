/** Tests for what `placeOrder` tells the deal ticket: whether the order was taken, so its values can clear. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { markets, setup } from "../engine/live-setup";
import { SessionKeySigner } from "../engine/session-key";
import { NotSentError, UntrustedError } from "../engine/trust";
import type { EngineEvent, Fill } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { disconnectWallet, placeOrder, withdraw } from "./actions";
import { ActionClient, BTC, connected, keyed, type Posted } from "./live-kit";
import { installKey } from "./session";
import { MAY_HAVE_RUN } from "./signing";
import { ConsoleStore } from "./store";

const FILL: Fill = { account: ACCOUNT, order_id: 7, market: 1, side: "buy", qty: "0.5", price: "100000", index: "100000", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "0.5", liquidation: false };
const CANCELLED = { type: "order_cancelled" as const, account: ACCOUNT, order_id: 7, reason: "unfillable" as const };

/** Answers the order's events, and the login's registration with the canned registered event. */
const answer = (events: EngineEvent[]) => (posted: Posted) =>
  posted.route === "session_key" ? new ActionClient().answer(posted) : { seq: 1, events };

const send = (store: ConsoleStore) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });

/** A store over a real live client, showing a verdict that may sign and connected to a wallet that signs anything, so a verdict the client reaches after this is one that ended while the wallet was open. */
function liveConnected(options: { nowMs?: number } = {}) {
  const live = setup(options);
  live.client.nonce = async () => ({ next_nonce: 4, time_ms: markets.time_ms });
  const wallet: Wallet = { address: ACCOUNT, label: "Test wallet", sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x" };
  const store = new ConsoleStore({ client: live.client, wallets: { options: [], connect: async () => wallet }, history: () => [], initial: { markets: [BTC], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  store.liveWallet = wallet;
  store.setWallet({ address: ACCOUNT, label: wallet.label });
  store.patch({ attestation: { kind: "mock" }, stream: "live" });
  installKey(store, SessionKeySigner.generate(), Number.MAX_SAFE_INTEGER);
  return { ...live, store };
}

describe("what the user is told of a request that stopped or went unanswered", () => {
  const stopped = "Nothing was sent. Connect a wallet to check the vault's current release before anything is signed.";

  it("says plainly that nothing went out when the last gate stopped it, on the session-signed and the wallet-signed path, and reads nothing again", async () => {
    const { client, store } = await keyed();
    client.answer = (posted) => {
      if (posted.route === "session_key") return new ActionClient().answer(posted);
      throw new NotSentError(stopped.replace("Nothing was sent. ", ""));
    };
    const reads = client.marketReads;
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe(stopped);
    expect(client.marketReads).toBe(reads);
    const unkeyed = await connected();
    unkeyed.client.answer = () => { throw new NotSentError(stopped.replace("Nothing was sent. ", "")); };
    unkeyed.store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    const unkeyedReads = unkeyed.client.marketReads;
    expect(await send(unkeyed.store)).toBe(false);
    expect(unkeyed.store.getSnapshot().toasts.at(-1)?.text).toBe(stopped);
    expect(unkeyed.client.marketReads).toBe(unkeyedReads);
  });

  it("tells a connection that came next nothing of a request the last gate stopped for the one before", async () => {
    const { client, store, wallet } = await connected();
    client.answer = () => {
      store.liveWallet = { ...wallet, address: "0x00000000000000000000000000000000000000bb" };
      throw new NotSentError("The node is not verified.");
    };
    store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    await send(store);
    expect(store.getSnapshot().toasts.some((toast) => toast.text.startsWith("Nothing was sent"))).toBe(false);
  });

  it("reports a verdict that ended with the wallet open as not sent, through the real gate, on both paths", async () => {
    for (const run of [(store: ConsoleStore) => withdraw(store, fixedFromInt(10)), send]) {
      const failed = liveConnected();
      failed.node.routes.set("/v1/attestation", () => new Response("", { status: 503 }));
      const verdict = await failed.client.verify();
      if (verdict.kind !== "unverified") throw new Error("the attestation route fails");
      expect(await run(failed.store)).toBe(false);
      expect(failed.store.getSnapshot().toasts.at(-1)?.text).toBe(`Nothing was sent. ${verdict.reason}`);
      expect(failed.node.posts).toEqual([]);
      expect(failed.node.requests.filter((request) => request.path === "/v1/markets")).toEqual([]);

      const wrongClock = liveConnected({ nowMs: markets.time_ms + 60_000 });
      await expect(wrongClock.client.markets()).rejects.toBeInstanceOf(UntrustedError);
      const reads = wrongClock.node.requests.length;
      expect(await run(wrongClock.store)).toBe(false);
      expect(wrongClock.store.getSnapshot().toasts.at(-1)?.text).toBe("Nothing was sent. Your device clock differs from the node's signed time by 60 s. Correct the clock and reload.");
      expect(wrongClock.node.posts).toEqual([]);
      expect(wrongClock.node.requests).toHaveLength(reads);
    }
  });

  it("still says a request that went out with no answer it can judge may have run", async () => {
    const { client, store } = await keyed();
    client.answer = (posted) => {
      if (posted.route === "session_key") return new ActionClient().answer(posted);
      throw new UntrustedError("The node's answer did not verify.");
    };
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe(`The node's answer did not verify.${MAY_HAVE_RUN}`);
  });
});

describe("what placeOrder reports", () => {
  it("is true for a fill", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "fill", ...FILL }]);
    expect(await send(store)).toBe(true);
  });

  it("is true for an order left resting, with no fill", async () => {
    const { client, store } = await keyed();
    client.answer = answer([]);
    expect(await send(store)).toBe(true);
  });

  it("is true for a partial fill whose remainder was cancelled", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "fill", ...FILL }, CANCELLED]);
    expect(await send(store)).toBe(true);
  });

  it("is false for a rejection", async () => {
    const { client, store } = await connected();
    client.answer = answer([{ type: "order_rejected", account: ACCOUNT, client_id: 1, reason: { kind: "no_price" } }]);
    expect(await send(store)).toBe(false);
  });

  it("is false for an order cancelled unfilled", async () => {
    const { client, store } = await connected();
    client.answer = answer([CANCELLED]);
    expect(await send(store)).toBe(false);
  });

  it("is false for a request the node refused", async () => {
    const { client, store } = await connected();
    client.answer = () => { throw new EngineError(400, "refused"); };
    expect(await send(store)).toBe(false);
  });

  it("is false with no wallet to sign, and for a zero quantity, posting nothing", async () => {
    const { client, store } = await connected();
    expect(await placeOrder(store, { market: 1, side: "buy", qty: 0n, kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false })).toBe(false);
    disconnectWallet(store);
    expect(await send(store)).toBe(false);
    expect(client.posted).toEqual([]);
  });
});
