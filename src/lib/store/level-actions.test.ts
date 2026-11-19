/** Tests for setting a position's levels and for an order naming them, against a live client whose answers the test sets: session-signed, one request each. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { orderTypedData, positionLevelsTypedData, requestDomain } from "../engine/eip712";
import vectors from "../engine/eip712-vectors.json";
import type { EngineEvent, OrderRequest, PositionLevelsRequest } from "../engine/types";
import { fixedFromInt, parseFixed } from "../fixed";
import { placeOrder } from "./actions";
import { setPositionLevels } from "./level-actions";
import { ActionClient, keyed, NODE_TIME, signerOf, VAULT } from "./live-kit";
import { REQUEST_TTL_MS } from "./signing";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);
const ME = vectors.account;
const TERMS = { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS };
const LEVELS = { takeProfit: fixedFromInt(105_000), stopLoss: parseFixed("95000.5") ?? 0n };

/** A logged-in store over a node that answers `events`, and its wallet prompt count after the login. */
async function setup(events: EngineEvent[]) {
  const kit = await keyed();
  kit.client.credited = true;
  kit.client.answer = () => ({ seq: 5, events });
  const prompts = () => kit.provider.calls.filter((c) => c.method === "eth_signTypedData_v4").length;
  return { ...kit, prompts, loginPrompts: prompts() };
}

const posted = (client: ActionClient, route: string) => client.posted.filter((p) => p.route === route).map((p) => p.body);

describe("setting a position's levels", () => {
  it("sends one request the session key signs over SetPositionLevels, with no wallet prompt, and says nothing", async () => {
    const { client, store, prompts, loginPrompts } = await setup([{ type: "position_levels_set", account: ME, market: 1, take_profit: "105000", stop_loss: "95000.5" }]);
    expect(await setPositionLevels(store, 1, LEVELS)).toBe(true);
    const [body] = posted(client, "levels") as PositionLevelsRequest[];
    expect(body).toMatchObject({ account: ME, market: 1, take_profit: "105000", stop_loss: "95000.5", auth: { nonce: 4 } });
    expect(await signerOf(positionLevelsTypedData(DOMAIN, { account: ME, market: 1, take_profit: "105000", stop_loss: "95000.5" }, TERMS), body?.auth?.signature)).toBe(store.sessionKey?.address.toLowerCase());
    expect(prompts()).toBe(loginPrompts);
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("removes both with a request that names neither", async () => {
    const { client, store } = await setup([{ type: "position_levels_set", account: ME, market: 1 }]);
    expect(await setPositionLevels(store, 1, { takeProfit: null, stopLoss: null })).toBe(true);
    expect(posted(client, "levels")[0]).not.toHaveProperty("take_profit");
    expect(posted(client, "levels")[0]).not.toHaveProperty("stop_loss");
  });

  it("says why the node refused it on the editor's own surface, ignoring another account's refusal in the same answer", async () => {
    const other: EngineEvent = { type: "order_rejected", account: "0x0000000000000000000000000000000000000bad", client_id: 0, reason: { kind: "unknown_market" } };
    const mine: EngineEvent = { type: "order_rejected", account: ME, client_id: 0, reason: { kind: "level_too_close", level: "100100", min_distance_bps: 30, reference: "99980" } };
    const { store } = await setup([other, mine]);
    expect(await setPositionLevels(store, 1, LEVELS)).toBe(false);
    expect(store.getSnapshot().notices.levels).toMatchObject({ tone: "error", text: expect.stringContaining("The level 100,100 was not accepted.") });
  });

  it("says a levels request refused for the working order limit was refused because the levels take a slot", async () => {
    const atLimit = async (reason: { kind: "tier_order_limit"; tier: number; max: number } | { kind: "too_many_orders"; max: number }) => {
      const { store } = await setup([{ type: "order_rejected", account: ME, client_id: 0, reason }]);
      expect(await setPositionLevels(store, 1, LEVELS)).toBe(false);
      return store.getSnapshot().notices.levels?.text;
    };
    expect(await atLimit({ kind: "tier_order_limit", tier: 1, max: 50 })).toBe("Working order limit reached. Volume tier 1 allows up to 50 working orders at a time, and the take profit and stop loss on a position together count as one. Cancel a working order, or remove the levels from another position, to set levels here.");
    expect(await atLimit({ kind: "too_many_orders", max: 25 })).toBe("Working order limit reached. Your account can have up to 25 working orders at a time, and the take profit and stop loss on a position together count as one. Cancel a working order, or remove the levels from another position, to set levels here.");
  });

  it("matches the refusal to the account that sent the request, though another is connected when the answer lands", async () => {
    const mine: EngineEvent = { type: "order_rejected", account: ME, client_id: 0, reason: { kind: "level_too_close", level: "100100", min_distance_bps: 30, reference: "99980" } };
    const { client, store } = await setup([]);
    client.answer = () => {
      store.setWallet({ address: "0x0000000000000000000000000000000000000b0b", label: "Other wallet" });
      return { seq: 6, events: [mine] };
    };
    expect(await setPositionLevels(store, 1, LEVELS)).toBe(false);
  });

  it("takes another account's refusal alone as no refusal of its own", async () => {
    const { store } = await setup([{ type: "order_rejected", account: "0x0000000000000000000000000000000000000bad", client_id: 0, reason: { kind: "unknown_market" } }]);
    expect(await setPositionLevels(store, 1, LEVELS)).toBe(true);
    expect(store.getSnapshot().notices.levels).toBeUndefined();
  });

  it("says a node that predates the route does not support levels", async () => {
    const { client, store } = await setup([]);
    client.answer = () => { throw new EngineError(404, "not found"); };
    expect(await setPositionLevels(store, 1, LEVELS)).toBe(false);
    expect(store.getSnapshot().notices.levels?.text).toBe("This server does not support take-profit and stop-loss levels yet.");
  });
});

describe("an order naming levels", () => {
  it("is signed with them over OrderWithLevels, and one naming none over OrderRequest", async () => {
    const { client, store } = await setup([{ type: "order_accepted", account: ME, client_id: 1, order_id: 9 }, { type: "fill", account: ME, order_id: 9, market: 1, side: "buy", qty: "1", price: "100", index: "100", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "1", liquidation: false }]);
    const params = { market: 1, side: "buy", qty: fixedFromInt(1), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 25 }, reduceOnly: false } as const;
    await placeOrder(store, { ...params, levels: { takeProfit: fixedFromInt(105_000), stopLoss: null } });
    await placeOrder(store, params);
    const [withLevels, without] = posted(client, "order") as OrderRequest[];
    expect(withLevels).toMatchObject({ take_profit: "105000" });
    expect(withLevels).not.toHaveProperty("stop_loss");
    expect(without).not.toHaveProperty("take_profit");
    if (withLevels?.auth === undefined) throw new Error("the order was not signed");
    const { auth, ...order } = withLevels;
    expect(await signerOf(orderTypedData(DOMAIN, order, { nonce: auth.nonce, expiresAt: auth.expires_at }), auth.signature)).toBe(store.sessionKey?.address.toLowerCase());
    expect(orderTypedData(DOMAIN, order, TERMS).primaryType).toBe("OrderWithLevels");
  });
});
