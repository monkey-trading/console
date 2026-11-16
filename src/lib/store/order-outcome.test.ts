/** Tests for what `placeOrder` tells the deal ticket: whether the order was taken, so its values can clear. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { markets, setup } from "../engine/live-setup";
import { SessionKeySigner } from "../engine/session-key";
import { OPERATOR_CLAIM } from "../engine/test-kit";
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

describe("an order refused for want of a price", () => {
  it("names why the market has no price, from the read that follows the refusal", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "order_rejected", account: ACCOUNT, client_id: 1, reason: { kind: "no_price" } }]);
    client.markets = async () => [{ ...BTC, pricing: { priced: false, unpriced: "too_few_sources", as_of_ms: 1, fresh_sources: 1, min_sources: 2, sources: [{ source: "coinbase", state: "counts", last_quote_ms: 1, age_ms: 0 }, { source: "kraken", state: "delayed", last_quote_ms: 1, age_ms: 4_000 }] } }];
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().notices.ticket?.text).toBe("No live price is currently available for this market because the prices received from Kraken are delayed.");
  });

  it("says why at once for any other refusal, before the read that follows it answers", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "order_rejected", account: ACCOUNT, client_id: 1, reason: { kind: "market_closed" } }]);
    let reading = () => {};
    const read = new Promise<void>((resolve) => { reading = resolve; });
    let answerRead: (markets: (typeof BTC)[]) => void = () => {};
    client.markets = () => { reading(); return new Promise((resolve) => { answerRead = resolve; }); };
    const sent = send(store);
    await read;
    expect(store.getSnapshot().notices.ticket?.text).toBe("This market is closed.");
    answerRead([BTC]);
    expect(await sent).toBe(false);
  });
});

describe("what the user is told of a request that stopped or went unanswered", () => {
  const stopped = "Your request was not sent. Connect a wallet to complete the verification, in which your wallet checks the server against the on-chain vault that holds deposits. You can trade and move funds once that check passes.";

  it("says plainly that nothing went out when the last gate stopped it, on the session-signed and the wallet-signed path, and reads nothing again", async () => {
    const { client, store } = await keyed();
    client.answer = (posted) => {
      if (posted.route === "session_key") return new ActionClient().answer(posted);
      throw new NotSentError(stopped.replace("Your request was not sent. ", ""));
    };
    const reads = client.marketReads;
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().notices.ticket?.text).toBe(stopped);
    expect(client.marketReads).toBe(reads);
    const unkeyed = await connected();
    unkeyed.client.answer = () => { throw new NotSentError(stopped.replace("Your request was not sent. ", "")); };
    unkeyed.store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    const unkeyedReads = unkeyed.client.marketReads;
    expect(await send(unkeyed.store)).toBe(false);
    expect(unkeyed.store.getSnapshot().notices.ticket?.text).toBe(stopped);
    expect(unkeyed.client.marketReads).toBe(unkeyedReads);
  });

  it("tells a connection that came next nothing of a request the last gate stopped for the one before", async () => {
    const { client, store, wallet } = await connected();
    client.answer = () => {
      store.liveWallet = { ...wallet, address: "0x00000000000000000000000000000000000000bb" };
      throw new NotSentError("The server has not yet been verified.");
    };
    store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    await send(store);
    expect(store.getSnapshot().notices.ticket).toBeUndefined();
  });

  it("reports a verdict that ended with the wallet open as not sent, through the real gate, on both paths", async () => {
    for (const [surface, run] of [["withdraw", (store: ConsoleStore) => withdraw(store, fixedFromInt(10))], ["ticket", send]] as const) {
      const failed = liveConnected();
      failed.node.routes.set("/v1/attestation", () => new Response("", { status: 503 }));
      const verdict = await failed.client.verify();
      if (verdict.kind !== "unverified") throw new Error("the attestation route fails");
      expect(await run(failed.store)).toBe(false);
      expect(failed.store.getSnapshot().notices[surface]?.text).toBe(`Your request was not sent. ${verdict.reason}`);
      expect(failed.node.posts).toEqual([]);
      expect(failed.node.requests.filter((request) => request.path === "/v1/markets")).toEqual([]);

      const wrongClock = liveConnected({ nowMs: markets.time_ms + 60_000 });
      await expect(wrongClock.client.markets()).rejects.toBeInstanceOf(UntrustedError);
      const reads = wrongClock.node.requests.length;
      expect(await run(wrongClock.store)).toBe(false);
      expect(wrongClock.store.getSnapshot().notices[surface]?.text).toBe("Your request was not sent. Your device clock differs from the server's time by 60 seconds. Correct the clock and reload the page.");
      expect(wrongClock.node.posts).toEqual([]);
      // The check is tried again before the gate refuses; nothing past it reaches the node.
      expect(wrongClock.node.requests.slice(reads).map((request) => request.path).filter((path) => path !== "/v1/attestation" && path !== OPERATOR_CLAIM)).toEqual([]);
    }
  });

  it("still says a request that went out with no answer it can judge may have run", async () => {
    const { client, store } = await keyed();
    client.answer = (posted) => {
      if (posted.route === "session_key") return new ActionClient().answer(posted);
      throw new UntrustedError("The node's answer did not verify.");
    };
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().notices.ticket?.text).toBe(`The node's answer did not verify.${MAY_HAVE_RUN}`);
  });
});

describe("what placeOrder reports", () => {
  it("is true for a fill", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "fill", ...FILL }]);
    expect(await send(store)).toBe(true);
    expect(store.getSnapshot().notices.ticket).toBeUndefined();
  });

  it("is true for an order left resting, with no fill", async () => {
    const { client, store } = await keyed();
    client.answer = answer([]);
    expect(await send(store)).toBe(true);
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("is true for a partial fill whose remainder was cancelled", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "fill", ...FILL }, CANCELLED]);
    expect(await send(store)).toBe(true);
  });

  it("is false for a rejection", async () => {
    const { client, store } = await keyed();
    client.answer = answer([{ type: "order_rejected", account: ACCOUNT, client_id: 1, reason: { kind: "no_price" } }]);
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().notices.ticket).toMatchObject({ tone: "error" });
  });

  it("is false for an order cancelled unfilled", async () => {
    const { client, store } = await keyed();
    client.answer = answer([CANCELLED]);
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().notices.ticket).toMatchObject({ tone: "error", text: "Your order could not be filled, so it has been cancelled." });
  });

  it("is false for a request the node refused", async () => {
    const { client, store } = await keyed();
    client.answer = () => { throw new EngineError(400, "refused"); };
    expect(await send(store)).toBe(false);
    expect(store.getSnapshot().notices.ticket?.tone).toBe("error");
  });

  it("is false with no wallet to sign, and for a zero quantity, posting nothing", async () => {
    const { client, store } = await connected();
    expect(await placeOrder(store, { market: 1, side: "buy", qty: 0n, kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false })).toBe(false);
    disconnectWallet(store);
    expect(await send(store)).toBe(false);
    expect(client.posted).toEqual([]);
  });
});
