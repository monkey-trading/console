/** Tests for what `placeOrder` tells the deal ticket: whether the order was taken, so its values can clear. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import type { EngineEvent, Fill } from "../engine/types";
import { ACCOUNT } from "../engine/wallet-kit";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { disconnectWallet, placeOrder } from "./actions";
import { ActionClient, connected, type Posted } from "./live-kit";
import type { ConsoleStore } from "./store";

const FILL: Fill = { account: ACCOUNT, order_id: 7, market: 1, side: "buy", qty: "0.5", price: "100000", index: "100000", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "0.5", liquidation: false };
const CANCELLED = { type: "order_cancelled" as const, account: ACCOUNT, order_id: 7, reason: "unfillable" as const };

/** Answers the order's events, and the login's registration with the canned registered event. */
const answer = (events: EngineEvent[]) => (posted: Posted) =>
  posted.route === "session_key" ? new ActionClient().answer(posted) : { seq: 1, events };

const send = (store: ConsoleStore) => placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false });

describe("what placeOrder reports", () => {
  it("is true for a fill", async () => {
    const { client, store } = await connected();
    client.answer = answer([{ type: "fill", ...FILL }]);
    expect(await send(store)).toBe(true);
  });

  it("is true for an order left resting, with no fill", async () => {
    const { client, store } = await connected();
    client.answer = answer([]);
    expect(await send(store)).toBe(true);
  });

  it("is true for a partial fill whose remainder was cancelled", async () => {
    const { client, store } = await connected();
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
