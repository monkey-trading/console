/** Tests for cancel all and close all against a live client whose answers the test sets: one signature and one request each. */

import { describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { cancelAllTypedData, closeAllTypedData, requestDomain } from "../engine/eip712";
import vectors from "../engine/eip712-vectors.json";
import type { CancelAllRequest, CloseAllRequest, EngineEvent, RestingOrder } from "../engine/types";
import { fixedFromInt } from "../fixed";
import { cancelAll, closeAll } from "./batch-actions";
import { ActionClient, connected, NODE_TIME, signerOf, VAULT } from "./live-kit";
import { loginSession } from "./session";
import { REQUEST_TTL_MS } from "./signing";

const DOMAIN = requestDomain(vectors.chain_id, VAULT);
const ME = vectors.account;
const BPS = 25;

const resting = (order_id: number, market: number): RestingOrder => ({ order_id, client_id: order_id, market, side: "buy", qty: "1", kind: { kind: "limit", price: "10" }, reduce_only: false });
const fill = (market: number): EngineEvent => ({ type: "fill", account: ME, order_id: market, market, side: "sell", qty: "1", price: "1", index: "1", spread_bps: 0, realised_pnl: "0", profit_fee: "0", position: "0", liquidation: false });
const rejected = (client_id: number, reason: Extract<EngineEvent, { type: "order_rejected" }>["reason"]): EngineEvent => ({ type: "order_rejected", account: ME, client_id, reason });
const cancelled = (order_id: number): EngineEvent => ({ type: "order_cancelled", account: ME, order_id, reason: "client" });
const slippage = { kind: "slippage", quoted: "100", live: "90", slippage_bps: 1000 } as const;

/** A logged-in store whose account holds orders, a second listed market, and a node that answers `answer`. */
async function setup(answer: (client: ActionClient) => ActionClient["answer"] = () => new ActionClient().answer) {
  const kit = await connected();
  const { client, store } = kit;
  client.credited = true;
  client.orders = { 7: resting(7, 1), 8: resting(8, 2), 9: resting(9, 1) };
  await loginSession(store);
  await store.refresh(true);
  const [btc] = store.getSnapshot().markets;
  if (!btc) throw new Error("no market");
  store.patch({ markets: [btc, { ...btc, id: 2, symbol: "ETH-USD", view: { ...btc.view, id: 2, symbol: "ETH-USD" } }] });
  client.answer = answer(client);
  const prompts = () => kit.provider.calls.filter((c) => c.method === "eth_signTypedData_v4").length;
  return { ...kit, prompts, loginPrompts: prompts() };
}

const TARGETS = [{ market: 2, quoted: fixedFromInt(3_000) }, { market: 1, quoted: fixedFromInt(100_000) }];
const routes = (client: ActionClient) => client.posted.map((p) => p.route).filter((r) => r !== "session_key");

describe("cancel all", () => {
  it("makes one request for every order in every market and no wallet prompt once logged in, and says what it cancelled once", async () => {
    const { client, store, prompts, loginPrompts } = await setup(() => () => ({ seq: 5, events: [cancelled(7), cancelled(8), cancelled(9)] }));
    const toasts = store.getSnapshot().toasts.length;
    const reads = client.marketReads;
    await cancelAll(store);
    // Exactly one request, to the batch route; never the single cancel.
    expect(routes(client)).toEqual(["cancel_all"]);
    expect(client.posted.at(-1)?.body).toMatchObject({ account: ME, auth: { nonce: 4, expires_at: NODE_TIME + REQUEST_TTL_MS } });
    expect(prompts()).toBe(loginPrompts);
    const body = client.posted.at(-1)?.body as CancelAllRequest;
    // The request is signed by the session key over the engine's CancelAllRequest.
    const typed = cancelAllTypedData(DOMAIN, body, { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS });
    expect(await signerOf(typed, body.auth?.signature)).toBe(store.sessionKey?.address.toLowerCase());
    expect(store.getSnapshot().toasts.slice(toasts)).toEqual([expect.objectContaining({ tone: "ok", text: "Cancelled 3 orders." })]);
    expect(client.marketReads).toBeGreaterThan(reads);
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("sends nothing when no order rests", async () => {
    const { client, store } = await setup();
    client.orders = {};
    await store.refresh(true);
    await cancelAll(store);
    expect(routes(client)).toEqual([]);
  });

  it("asks the wallet exactly once when the node refuses the session key, and still posts once", async () => {
    const { client, store, prompts } = await connected().then(async (kit) => {
      kit.client.credited = true;
      kit.client.orders = { 7: resting(7, 1) };
      await kit.store.refresh(true);
      kit.client.answer = (posted) => posted.route === "session_key"
        ? { seq: 1, events: [{ type: "session_key_rejected", account: ME, session_key: (posted.body as { session_key: string }).session_key, reason: { kind: "too_many_session_keys", max: 10 } }] }
        : { seq: 2, events: [cancelled(7)] };
      return { ...kit, prompts: () => kit.provider.calls.filter((c) => c.method === "eth_signTypedData_v4" && JSON.stringify(c.params).includes("CancelAllRequest")).length };
    });
    await cancelAll(store);
    expect(routes(client)).toEqual(["cancel_all"]);
    expect(prompts()).toBe(1);
  });

  it("signs again with the nonce a 409 names, since running it twice cancels nothing more", async () => {
    const { client, store } = await setup((c) => (posted) => {
      if (posted.route === "cancel_all" && c.posted.filter((p) => p.route === "cancel_all").length === 1) throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 });
      return { seq: 5, events: [cancelled(7)] };
    });
    await cancelAll(store);
    expect(client.posted.filter((p) => p.route === "cancel_all").map((p) => (p.body as CancelAllRequest).auth?.nonce)).toEqual([4, 9]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("Cancelled 1 order.");
  });

  it("reports a refusal of the request as nothing cancelled", async () => {
    const { store } = await setup(() => () => ({ seq: 5, events: [rejected(0, { kind: "batch_unsupported" })] }));
    await cancelAll(store);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: expect.stringMatching(/^Nothing was cancelled\. This node cannot cancel or close everything/) });
  });

  it("says plainly that an older node does not support it, and does not loop over single cancels", async () => {
    const { client, store } = await setup(() => () => { throw new EngineError(404, "The node answered HTTP 404."); });
    await cancelAll(store);
    expect(routes(client)).toEqual(["cancel_all"]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("This node does not support cancel all yet. It needs to restart onto a newer version.");
  });
});

describe("close all", () => {
  it("makes one request with every entry in order and no order placed, with no wallet prompt once logged in", async () => {
    const { client, store, prompts, loginPrompts } = await setup(() => () => ({ seq: 6, events: [fill(2), fill(1)] }));
    const toasts = store.getSnapshot().toasts.length;
    await closeAll(store, TARGETS, BPS);
    expect(routes(client)).toEqual(["close_all"]);
    const body = client.posted.at(-1)?.body as CloseAllRequest;
    // The wire decimals the Close buttons quote, in list order, under the one bound.
    expect(body).toMatchObject({ account: ME, closes: [{ market: 2, quoted: "3000" }, { market: 1, quoted: "100000" }], max_slippage_bps: BPS, auth: { nonce: 4, expires_at: NODE_TIME + REQUEST_TTL_MS } });
    expect(prompts()).toBe(loginPrompts);
    const typed = closeAllTypedData(DOMAIN, body, { nonce: 4, expiresAt: NODE_TIME + REQUEST_TTL_MS });
    expect(typed.message).toMatchObject({ closes: [{ market: 2, quoted: 3_000_000_000_000n }, { market: 1, quoted: 100_000_000_000_000n }], hasMaxSlippage: true, maxSlippageBps: 25n });
    expect(await signerOf(typed, body.auth?.signature)).toBe(store.sessionKey?.address.toLowerCase());
    expect(store.getSnapshot().toasts.slice(toasts)).toEqual([expect.objectContaining({ tone: "ok", text: "Closed 2 positions." })]);
  });

  it("asks the wallet exactly once for the request when the node refuses the session key", async () => {
    const kit = await connected();
    kit.client.credited = true;
    kit.client.answer = (posted) => posted.route === "session_key"
      ? { seq: 1, events: [{ type: "session_key_rejected", account: ME, session_key: (posted.body as { session_key: string }).session_key, reason: { kind: "too_many_session_keys", max: 10 } }] }
      : { seq: 2, events: [fill(1)] };
    await closeAll(kit.store, [{ market: 1, quoted: fixedFromInt(100_000) }], BPS);
    expect(routes(kit.client)).toEqual(["close_all"]);
    expect(kit.provider.calls.filter((c) => c.method === "eth_signTypedData_v4" && JSON.stringify(c.params).includes("CloseAllRequest"))).toHaveLength(1);
  });

  it("names the market whose entry was rejected, by its list index, and the count that closed", async () => {
    const { store } = await setup(() => () => ({ seq: 6, events: [rejected(0, slippage), fill(1)] }));
    await closeAll(store, TARGETS, BPS);
    expect(store.getSnapshot().toasts.at(-1)).toMatchObject({ tone: "error", text: "Closed 1 of 2 positions; ETH-USD moved past its slippage bound." });
  });

  it("does not mistake a refusal of the whole request for entry 0's rejection", async () => {
    const { store } = await setup(() => () => ({ seq: 6, events: [rejected(0, { kind: "batch_unsupported" })] }));
    await closeAll(store, TARGETS, BPS);
    const text = store.getSnapshot().toasts.at(-1)?.text ?? "";
    expect(text).toMatch(/^Nothing was closed\. This node cannot cancel or close everything/);
    expect(text).not.toContain("ETH-USD");
  });

  it("reads a lone rejection of the only entry as that entry's", async () => {
    const { store } = await setup(() => () => ({ seq: 6, events: [rejected(0, slippage)] }));
    await closeAll(store, [{ market: 2, quoted: fixedFromInt(3_000) }], BPS);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("No position was closed: ETH-USD moved past its slippage bound.");
  });

  it("does not sign again after a 409, since a copy may have run, and says so", async () => {
    const { client, store } = await setup(() => () => { throw new EngineError(409, "invalid nonce", { kind: "invalid_nonce", expected: 9 }); });
    const reads = client.marketReads;
    await closeAll(store, TARGETS, BPS);
    expect(client.posted.filter((p) => p.route === "close_all")).toHaveLength(1);
    expect(client.marketReads).toBeGreaterThan(reads);
    expect(store.getSnapshot().toasts.at(-1)?.text).toMatch(/^The node had already used nonce 4 for this account, so it did not take this request as sent\./);
  });

  it("says plainly that an older node does not support it, and falls back to no single orders", async () => {
    const { client, store } = await setup(() => () => { throw new EngineError(404, "The node answered HTTP 404."); });
    await closeAll(store, TARGETS, BPS);
    expect(routes(client)).toEqual(["close_all"]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("This node does not support close all yet. It needs to restart onto a newer version.");
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("sends nothing for an empty list", async () => {
    const { client, store } = await setup();
    await closeAll(store, [], BPS);
    expect(routes(client)).toEqual([]);
  });
});
