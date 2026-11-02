/** Tests that a failed money or signing action says so on the surface of the control the user used, and nowhere else. */

import { describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import { parseDeploy } from "../engine/deploy";
import vectors from "../engine/eip712-vectors.json";
import { fixedFromInt, fixedFromWire } from "../fixed";
import { attestEligibility, deposit, fundWithAnvil, placeOrder, withdraw } from "./actions";
import { cancelAll, closeAll } from "./batch-actions";
import { ActionClient, connected, keyed, VAULT } from "./live-kit";
import type { NoticeSurface } from "./state";
import type { ConsoleStore } from "./store";

const DECLINED = { eth_signTypedData_v4: { code: 4001, message: "User rejected" } };
const FUNDED = { balance: 1_000_000_000n, allowance: 1_000_000_000n };
const REFUSED = (): never => { throw new EngineError(400, "The node refused the request."); };

/** The one surface holding a notice, which must be an error naming `text`. */
function expectOnly(store: ConsoleStore, surface: NoticeSurface, text: string | RegExp) {
  const { notices } = store.getSnapshot();
  expect(Object.keys(notices)).toEqual([surface]);
  expect(notices[surface]?.tone).toBe("error");
  expect(notices[surface]?.text).toMatch(text);
  expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
}

const order = (store: ConsoleStore, surface?: NoticeSurface) =>
  placeOrder(store, { market: 1, side: "buy", qty: fixedFromWire("0.5"), kind: { kind: "market", quoted: fixedFromInt(100_000), slippageBps: 10 }, reduceOnly: false }, surface);

/** A keyed store whose node answers the registration and refuses everything after it. */
async function refusing() {
  const kit = await keyed();
  kit.client.answer = (posted) => (posted.route === "session_key" ? new ActionClient().answer(posted) : REFUSED());
  return kit;
}

describe("a refused or failed action lands on its own surface", () => {
  it("ticket: a node refusal, and a wallet signature declined on the wallet-signed path", async () => {
    const refused = await refusing();
    expect(await order(refused.store)).toBe(false);
    expectOnly(refused.store, "ticket", "The node refused the request.");
    const kit = await connected({ fail: DECLINED });
    kit.store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    expect(await order(kit.store)).toBe(false);
    expect(kit.client.posted).toEqual([]);
    expectOnly(kit.store, "ticket", "You declined to sign in your wallet.");
  });

  it("positions: a close the node refuses or the wallet declines names the positions, not the ticket", async () => {
    const refused = await refusing();
    expect(await order(refused.store, "positions")).toBe(false);
    expectOnly(refused.store, "positions", "The node refused the request.");
    const kit = await connected({ fail: DECLINED });
    kit.store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    expect(await order(kit.store, "positions")).toBe(false);
    expectOnly(kit.store, "positions", "You declined to sign in your wallet.");
  });

  it("positions: a close-all the node refuses, and orders: a cancel-all the wallet declines", async () => {
    const refused = await refusing();
    await closeAll(refused.store, [{ market: 1, quoted: fixedFromInt(100_000) }], 25);
    expectOnly(refused.store, "positions", "The node refused the request.");
    const kit = await connected({ fail: DECLINED });
    kit.client.credited = true;
    kit.client.orders = { 7: { order_id: 7, client_id: 7, market: 1, side: "buy", qty: "1", kind: { kind: "limit", price: "10" }, reduce_only: false } };
    await kit.store.refresh(true);
    kit.store.patch({ sessionRefusal: { kind: "too_many_session_keys", max: 10 } });
    await cancelAll(kit.store);
    expectOnly(kit.store, "orders", "You declined to sign in your wallet.");
  });

  it("withdraw: a declined signature, a node refusal, and a request the node answers with a rejection", async () => {
    const declined = await connected({ fail: DECLINED });
    await withdraw(declined.store, fixedFromInt(10));
    expectOnly(declined.store, "withdraw", "You declined to sign in your wallet.");
    const refused = await connected();
    refused.client.answer = REFUSED;
    await withdraw(refused.store, fixedFromInt(10));
    expectOnly(refused.store, "withdraw", "The node refused the request.");
    const rejected = await connected();
    rejected.client.answer = () => ({ seq: 1, events: [{ type: "withdrawal_rejected", account: vectors.account, amount: "10", reason: { kind: "insufficient_funds", available: "0" } }] });
    expect(await withdraw(rejected.store, fixedFromInt(10))).toBe(false);
    expect(Object.keys(rejected.store.getSnapshot().notices)).toEqual(["withdraw"]);
  });

  it("deposit: a declined transaction and a reverted one land on the deposit form, or on setup when setup sent it", async () => {
    const declined = await connected({ ...FUNDED, fail: { eth_sendTransaction: { code: 4001, message: "User rejected" } } });
    await deposit(declined.store, fixedFromInt(100));
    expectOnly(declined.store, "deposit", /declined/i);
    const reverted = await connected({ ...FUNDED, receiptStatus: "0x0" });
    await deposit(reverted.store, fixedFromInt(100));
    expect(Object.keys(reverted.store.getSnapshot().notices)).toEqual(["deposit"]);
    expect(reverted.store.getSnapshot().notices.deposit?.tone).toBe("error");
    const inSetup = await connected({ ...FUNDED, fail: { eth_sendTransaction: { code: 4001, message: "User rejected" } } });
    await deposit(inSetup.store, fixedFromInt(100), "setup");
    expectOnly(inSetup.store, "setup", /declined/i);
  });

  it("faucet: a declined or reverted mint, or on setup when setup minted", async () => {
    const rpc = { eth_getBalance: { result: "0xde0b6b3a7640000" } };
    vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: string }) => ({ ok: true, json: async () => rpc[(JSON.parse(init?.body ?? "{}") as { method: "eth_getBalance" }).method] }) as Response);
    try {
      const deploy = parseDeploy({ mode: "live-dev", origin: "https://127.0.0.1:8080", chainId: String(vectors.chain_id), vault: VAULT, usdc: "0x00000000000000000000000000000000000000cc", devOrigins: "https://127.0.0.1:8080", rpcUrl: "http://127.0.0.1:8545" });
      const declined = await connected({ ...FUNDED, fail: { eth_sendTransaction: { code: 4001, message: "User rejected" } } });
      expect(await fundWithAnvil(declined.store, deploy)).toBe(false);
      expectOnly(declined.store, "faucet", /declined/i);
      const reverted = await connected({ ...FUNDED, receiptStatus: "0x0" });
      expect(await fundWithAnvil(reverted.store, deploy)).toBe(false);
      expect(Object.keys(reverted.store.getSnapshot().notices)).toEqual(["faucet"]);
      const inSetup = await connected({ ...FUNDED, fail: { eth_sendTransaction: { code: 4001, message: "User rejected" } } });
      expect(await fundWithAnvil(inSetup.store, deploy, "setup")).toBe(false);
      expectOnly(inSetup.store, "setup", /declined/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("setup: a declared eligibility the wallet declines or the node refuses", async () => {
    const declined = await connected({ fail: DECLINED });
    expect(await attestEligibility(declined.store, "professional")).toBe(false);
    expectOnly(declined.store, "setup", "You declined to sign in your wallet.");
    const refused = await connected();
    refused.client.answer = REFUSED;
    expect(await attestEligibility(refused.store, "professional")).toBe(false);
    expectOnly(refused.store, "setup", "The node refused the request.");
  });
});
