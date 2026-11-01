/** Tests for the mock node's session keys: registration, the orders-and-cancels scope, and refusals. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, fixedToWire, parseFixed } from "../fixed";
import { MAX_SESSION_KEY_EXPIRY_MS } from "./session-keys";
import { createMockNode } from "./index";
import { auth, funded, ME, order, START, types } from "./test-helpers";

const KEY = "0xdef0000000000000000000000000000000000002";
const OTHER_KEY = "0xdef0000000000000000000000000000000000003";
const SIG = `0x${"cd".repeat(65)}`;

/** Registers `key` for `ME` until `expiresAt`, account-signed. */
function register(node: ReturnType<typeof createMockNode>, key: string, expiresAt: number) {
  return node.client.registerSessionKey({ account: ME, session_key: key, expires_at: expiresAt, auth: auth(node) });
}

/** An order whose auth carries the session key's nonce, as the console signs it. */
async function keyOrder(node: ReturnType<typeof createMockNode>, key: string, nonce: number) {
  const mark = (await node.client.markets()).find((m) => m.id === 1)?.mark ?? "0";
  return node.client.placeOrder({
    account: ME, client_id: 1, market: 1, side: "buy", qty: "0.01",
    kind: { kind: "market", quoted: mark, max_slippage_bps: 50 },
    auth: { nonce, expires_at: node.client.state.now + 60_000, signature: SIG },
  });
}

describe("session keys", () => {
  it("registers a key and admits its orders and cancels on the key's own nonce sequence", async () => {
    const node = await funded(10_000);
    const until = node.client.state.now + MAX_SESSION_KEY_EXPIRY_MS;
    const out = await register(node, KEY, until);
    expect(types(out.events)).toEqual(["session_key_registered"]);
    // The key's first request runs on a fresh sequence, next to the account's own.
    expect((await node.client.nonce(KEY)).next_nonce).toBe(0);
    expect((await node.client.nonce(ME)).next_nonce).toBe(2);
    const filled = await keyOrder(node, KEY, 0);
    expect(types(filled.events)).toContain("fill");
    expect((await node.client.nonce(KEY)).next_nonce).toBe(1);
    // A cancel with the key's next nonce is admitted too: a limit order far from the mark rests,
    // and the key cancels it (an account order first keeps the two sequences apart, since the mock
    // names a signer by matching the account's sequence before a key's).
    const mark = parseFixed((await node.client.markets()).find((m) => m.id === 1)?.mark ?? "0") ?? 0n;
    const rested = await node.client.placeOrder({
      account: ME, client_id: 2, market: 1, side: "buy", qty: "0.01", kind: { kind: "limit", price: fixedToWire(mark / 2n) },
      auth: { nonce: 1, expires_at: node.client.state.now + 60_000, signature: SIG },
    });
    expect(types(rested.events)).toContain("order_accepted");
    const orderId = (rested.events.find((e) => e.type === "order_accepted") as { order_id: number }).order_id;
    await order(node, "0.01", "buy"); // the account's own request, so its sequence moves past the key's
    const cancelled = await node.client.cancelOrder({ account: ME, order_id: orderId, auth: { nonce: 2, expires_at: node.client.state.now + 60_000, signature: SIG } });
    expect(types(cancelled.events)).toContain("order_cancelled");
    expect((await node.client.nonce(KEY)).next_nonce).toBe(3);
  });

  it("refuses a session key's withdrawal in the log, spending the key's nonce as the engine does", async () => {
    const node = await funded(10_000);
    await register(node, KEY, node.client.state.now + 60_000);
    const out = await node.client.withdraw({ account: ME, amount: "10", auth: { nonce: 0, expires_at: node.client.state.now + 60_000, signature: SIG } });
    expect(out.events).toMatchObject([{ type: "withdrawal_rejected", reason: { kind: "session_key_scope" } }]);
    expect((await node.client.nonce(KEY)).next_nonce).toBe(1);
  });

  it("refuses a revoked key distinctly and re-registration replaces it", async () => {
    const node = await funded(10_000);
    const until = node.client.state.now + 60_000;
    await register(node, KEY, until);
    const revoked = await node.client.revokeSessionKey({ account: ME, session_key: KEY, auth: auth(node) });
    expect(types(revoked.events)).toEqual(["session_key_revoked"]);
    await expect(keyOrder(node, KEY, 0)).rejects.toMatchObject({ status: 401, message: "session key revoked" });
    // Re-registering the known key replaces the revocation and does not count against the cap.
    const again = await register(node, KEY, until);
    expect(types(again.events)).toEqual(["session_key_registered"]);
    expect((await node.client.nonce(KEY)).next_nonce).toBe(1); // the spent nonce stays spent
    await keyOrder(node, KEY, 1);
  });

  it("refuses an expired key distinctly, by the node's clock", async () => {
    const node = await funded(10_000);
    await register(node, KEY, node.client.state.now + 1_000);
    node.client.tick(node.client.state.now + 2_000);
    await expect(keyOrder(node, KEY, 0)).rejects.toMatchObject({ status: 401, message: "session key expired" });
  });

  it("refuses a nonce no sequence matches, and never spends the account's nonce on a key request", async () => {
    const node = await funded(10_000);
    await register(node, KEY, node.client.state.now + 60_000);
    await expect(keyOrder(node, KEY, 7)).rejects.toMatchObject({ status: 409, reject: { kind: "invalid_nonce", expected: 2 } });
    expect((await node.client.nonce(ME)).next_nonce).toBe(2);
    expect((await node.client.nonce(KEY)).next_nonce).toBe(0);
  });

  it("caps the registration expiry at 24 hours and the live keys at ten", async () => {
    const node = await funded(10_000);
    const now = node.client.state.now;
    const tooFar = await register(node, KEY, now + MAX_SESSION_KEY_EXPIRY_MS + 1);
    expect(tooFar.events).toMatchObject([{ type: "session_key_rejected", reason: { kind: "expiry_too_far" } }]);
    for (let i = 0; i < 10; i++) await register(node, `0x${String(i).padStart(2, "0")}f00000000000000000000000000000000000001`, now + 60_000);
    const eleventh = await register(node, OTHER_KEY, now + 60_000);
    expect(eleventh.events).toMatchObject([{ type: "session_key_rejected", reason: { kind: "too_many_session_keys", max: 10 } }]);
    // A known key re-registers past a full house.
    const first = `0x${String(0).padStart(2, "0")}f00000000000000000000000000000000000001`;
    const renewed = await register(node, first, now + 120_000);
    expect(types(renewed.events)).toEqual(["session_key_registered"]);
  });

  it("refuses a never-credited account's registration, as the node does, and admits it after a deposit", async () => {
    const node = createMockNode(START);
    await expect(register(node, KEY, node.client.state.now + 60_000)).rejects.toMatchObject({ status: 403, message: "account has never been credited" });
    await node.client.attestEligibility({ account: ME, class: "professional", auth: auth(node) });
    node.controls.deposit(ME, fixedFromInt(1_000));
    const out = await register(node, KEY, node.client.state.now + 60_000);
    expect(types(out.events)).toEqual(["session_key_registered"]);
  });

  it("refuses a registration naming the account itself, and a revocation of a key never registered", async () => {
    const node = await funded(10_000);
    const own = await register(node, ME, node.client.state.now + 60_000);
    expect(own.events).toMatchObject([{ type: "session_key_rejected", reason: { kind: "invalid_session_key" } }]);
    const unknown = await node.client.revokeSessionKey({ account: ME, session_key: OTHER_KEY, auth: auth(node) });
    expect(unknown.events).toMatchObject([{ type: "session_key_rejected", reason: { kind: "invalid_session_key" } }]);
  });

  it("still admits account-signed orders after a key registered, on the account's sequence", async () => {
    const node = await funded(10_000);
    await register(node, KEY, node.client.state.now + 60_000);
    const filled = await order(node, "0.01", "buy");
    expect(types(filled.events)).toContain("fill");
    expect((await node.client.nonce(ME)).next_nonce).toBe(3);
  });
});
