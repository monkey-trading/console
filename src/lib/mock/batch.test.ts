/** Tests for the mock node's cancel-all and close-all, which follow the engine's V44 rules. */

import { describe, expect, it } from "vitest";

import type { CloseEntry, EngineEvent } from "../engine/types";
import { fixedFromWire, fixedToWire } from "../fixed";
import { createMockNode, type MockNode } from "./index";
import { auth, funded, ME, order, START, types } from "./test-helpers";

const markOf = async (node: MockNode, market: number) => (await node.client.markets()).find((m) => m.id === market)?.mark ?? "0";
const nonceOf = (node: MockNode) => node.client.state.account(ME).nextNonce;
/** Rests a buy limit at half the mark, which no sell reaches, for a notional above the market's minimum. */
const rest = async (node: MockNode, market: number, client_id = 1) =>
  node.client.placeOrder({
    account: ME, client_id, market, side: "buy", qty: market === 1 ? "0.01" : "0.5",
    kind: { kind: "limit", price: fixedToWire(fixedFromWire(await markOf(node, market)) / 2n) }, auth: auth(node),
  });
/** A close entry quoted at the market's mark, as a Close button quotes it. */
const entry = async (node: MockNode, market: number, scale = 1): Promise<CloseEntry> => ({ market, quoted: fixedToWire((fixedFromWire(await markOf(node, market)) * BigInt(Math.round(scale * 1000))) / 1000n) });
const closeAll = (node: MockNode, closes: CloseEntry[], extra: { max_slippage_bps?: number } = {}) =>
  node.client.closeAll({ account: ME, closes, ...extra, auth: auth(node) });

describe("cancel all", () => {
  it("cancels every resting order in every market on one nonce, in order id order", async () => {
    const node = await funded(100_000);
    const ids = [await rest(node, 1), await rest(node, 2), await rest(node, 1, 2)].map((r) => r.events.find((e) => e.type === "order_accepted"));
    const accepted = ids.flatMap((e) => (e?.type === "order_accepted" ? [e.order_id] : []));
    expect(accepted).toHaveLength(3);
    const before = nonceOf(node);
    const result = await node.client.cancelAll({ account: ME, auth: auth(node) });
    expect(result.events).toEqual(accepted.map((order_id) => ({ type: "order_cancelled", account: ME, order_id, reason: "client" })));
    expect(node.client.state.account(ME).orders.size).toBe(0);
    expect(nonceOf(node)).toBe(before + 1);
  });

  it("with nothing resting answers no events and still uses its nonce", async () => {
    const node = await funded(1_000);
    const before = nonceOf(node);
    expect((await node.client.cancelAll({ account: ME, auth: auth(node) })).events).toEqual([]);
    expect(nonceOf(node)).toBe(before + 1);
  });

  it("refuses a stale nonce and cancels nothing", async () => {
    const node = await funded(100_000);
    await rest(node, 1);
    const stale = auth(node);
    await order(node, "0.01", "buy");
    await expect(node.client.cancelAll({ account: ME, auth: stale })).rejects.toMatchObject({ status: 409, reject: { kind: "invalid_nonce" } });
    expect(node.client.state.account(ME).orders.size).toBe(1);
  });

  it("leaves other accounts' orders alone", async () => {
    const node = await funded(100_000);
    await rest(node, 1);
    const other = "0xabc0000000000000000000000000000000000002";
    node.client.state.account(other).orders.set(99, { order_id: 99, client_id: 1, market: 1, side: "buy", qty: "1", kind: { kind: "limit", price: "1" }, reduce_only: false });
    await node.client.cancelAll({ account: ME, auth: auth(node) });
    expect(node.client.state.account(other).orders.has(99)).toBe(true);
  });
});

describe("close all", () => {
  it("closes each listed position as its own reduce-only order, in list order, on one nonce", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    await order(node, "1", "sell", {}, 2);
    const before = nonceOf(node);
    const result = await closeAll(node, [await entry(node, 2), await entry(node, 1)], { max_slippage_bps: 50 });
    expect(types(result.events)).toEqual(["order_accepted", "fill", "order_accepted", "fill"]);
    const fills = result.events.flatMap((e) => (e.type === "fill" ? [e] : []));
    expect(fills.map((f) => [f.market, f.side, f.position])).toEqual([[2, "buy", "0"], [1, "sell", "0"]]);
    expect(node.client.state.account(ME).positions.size).toBe(0);
    expect(nonceOf(node)).toBe(before + 1);
  });

  it("rejects an entry past its slippage bound with its list index as client_id, and the others still close", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    await order(node, "1", "buy", {}, 2);
    // Quoted far above the mark, a sell of ETH fills well below it.
    const result = await closeAll(node, [await entry(node, 1), await entry(node, 2, 1.5)], { max_slippage_bps: 25 });
    const rejected = result.events.filter((e): e is Extract<EngineEvent, { type: "order_rejected" }> => e.type === "order_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ client_id: 1, reason: { kind: "slippage" } });
    expect(result.events.filter((e) => e.type === "fill")).toHaveLength(1);
    expect([...node.client.state.account(ME).positions.keys()]).toEqual([2]);
  });

  it("rejects the first entry with client_id 0 while the second closes, so entry 0 is no refusal of the request", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    await order(node, "1", "buy", {}, 2);
    const result = await closeAll(node, [await entry(node, 1, 1.5), await entry(node, 2)], { max_slippage_bps: 25 });
    expect(types(result.events)).toEqual(["order_rejected", "order_accepted", "fill"]);
    expect(result.events[0]).toMatchObject({ client_id: 0, reason: { kind: "slippage" } });
  });

  it("rejects an entry with no position as a reduce-only order with nothing to reduce", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    const result = await closeAll(node, [await entry(node, 1), await entry(node, 2)]);
    expect(result.events.at(-1)).toMatchObject({ type: "order_rejected", client_id: 1, reason: { kind: "reduce_only" } });
  });

  it("rejects a quote above the engine's input bound as that entry's, and the others still close", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    await order(node, "1", "sell", {}, 2);
    const result = await closeAll(node, [{ market: 2, quoted: "1000000001" }, await entry(node, 1)]);
    expect(result.events[0]).toEqual({ type: "order_rejected", account: ME, client_id: 0, reason: { kind: "invalid_order", reason: "price out of range" } });
    expect(result.events.filter((e) => e.type === "fill")).toHaveLength(1);
    expect([...node.client.state.account(ME).positions.keys()]).toEqual([2]);
  });

  it("rejects an unlisted market as that entry's", async () => {
    const node = await funded(100_000);
    const result = await closeAll(node, [{ market: 999, quoted: "1" }]);
    expect(result.events).toEqual([{ type: "order_rejected", account: ME, client_id: 0, reason: { kind: "unknown_market" } }]);
  });

  it("refuses an empty list or a market named twice as a lone rejection with client_id 0, spending the nonce", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    const before = nonceOf(node);
    const empty = await closeAll(node, []);
    expect(empty.events).toEqual([{ type: "order_rejected", account: ME, client_id: 0, reason: { kind: "invalid_order", reason: "no markets to close" } }]);
    const twice = await closeAll(node, [await entry(node, 1), await entry(node, 1)]);
    expect(twice.events).toEqual([{ type: "order_rejected", account: ME, client_id: 0, reason: { kind: "invalid_order", reason: "market named twice" } }]);
    expect(nonceOf(node)).toBe(before + 2);
    expect(node.client.state.account(ME).positions.size).toBe(1);
  });

  it("refuses more entries than listed markets with a 400 before the signature, spending no nonce", async () => {
    const node = await funded(100_000);
    const before = nonceOf(node);
    const many = Array.from({ length: node.client.state.markets.size + 1 }, (_, i) => ({ market: i + 1, quoted: "1" }));
    await expect(closeAll(node, many)).rejects.toMatchObject({ status: 400, message: "more closes than listed markets" });
    expect(nonceOf(node)).toBe(before);
  });

  it("is screened as a single order is: a refused region and a missing attestation both answer 403", async () => {
    const node = await funded(100_000);
    node.controls.setRegion("united_states");
    await expect(closeAll(node, [{ market: 1, quoted: "1" }])).rejects.toMatchObject({ status: 403, reject: { kind: "access", reason: "united_states" } });
    const bare = createMockNode(START);
    await expect(bare.client.closeAll({ account: ME, closes: [{ market: 1, quoted: "1" }], auth: auth(bare) })).rejects.toMatchObject({ status: 403, reject: { kind: "access", reason: "eligibility_required" } });
  });

  it("refuses a stale nonce and closes nothing", async () => {
    const node = await funded(100_000);
    await order(node, "0.05", "buy", {}, 1);
    const stale = auth(node);
    await order(node, "0.01", "buy");
    await expect(node.client.closeAll({ account: ME, closes: [await entry(node, 1)], auth: stale })).rejects.toMatchObject({ status: 409 });
    expect(node.client.state.account(ME).positions.size).toBe(1);
  });
});
