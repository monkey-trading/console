/** Tests for the dev-only faucet: its live-dev gating and the Anvil gas top-up's branches. */

import { describe, expect, it } from "vitest";

import { parseDeploy, type RawDeploy } from "./deploy";
import { FAUCET_GAS_WEI, FAUCET_USDC, faucetAvailable, topUpGas, type JsonRpcPost } from "./faucet";

const LIVE_DEV: RawDeploy = {
  mode: "live-dev",
  origin: "https://127.0.0.1:8080",
  chainId: "31337",
  vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  usdc: "0x00000000000000000000000000000000000000cc",
  devOrigins: "https://127.0.0.1:8080",
  rpcUrl: "http://127.0.0.1:8545",
};

const ACCOUNT = "0x00000000000000000000000000000000000000aa";
const RPC = "http://127.0.0.1:8545/";

/** A post stub that replays `answers` by method name, recording every request body. */
function stub(answers: Record<string, unknown>) {
  const bodies: unknown[] = [];
  const post: JsonRpcPost = async (_url, body) => {
    bodies.push(body);
    const method = (body as { method?: unknown }).method;
    if (typeof method !== "string" || !(method in answers)) throw new Error(`unexpected method ${String(method)}`);
    return answers[method];
  };
  return { post, bodies };
}

describe("faucetAvailable", () => {
  it("offers the faucet only in a live-dev build naming the USDC and the RPC", () => {
    expect(faucetAvailable(parseDeploy(LIVE_DEV))).toBe(true);
    expect(faucetAvailable(parseDeploy({ ...LIVE_DEV, mode: "live" }))).toBe(false);
    expect(faucetAvailable(parseDeploy({ ...LIVE_DEV, mode: "mock" }))).toBe(false);
    expect(faucetAvailable(parseDeploy({ ...LIVE_DEV, usdc: undefined }))).toBe(false);
    expect(faucetAvailable(parseDeploy({ ...LIVE_DEV, rpcUrl: undefined }))).toBe(false);
  });
});

describe("topUpGas", () => {
  it("sets the balance to 1 ETH when it is short, asking Anvil for exactly that", async () => {
    const { post, bodies } = stub({
      eth_getBalance: { result: "0x0" },
      anvil_setBalance: { result: null },
    });
    await expect(topUpGas(RPC, ACCOUNT, post)).resolves.toEqual({ ok: true, toppedUp: true });
    // Anvil's server 204s a body without the JSON-RPC version field, so the shape is pinned here.
    expect(bodies).toEqual([
      { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [ACCOUNT, "latest"] },
      { jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [ACCOUNT, `0x${FAUCET_GAS_WEI.toString(16)}`] },
    ]);
  });

  it("does nothing when the balance already holds 1 ETH", async () => {
    const { post, bodies } = stub({ eth_getBalance: { result: `0x${FAUCET_GAS_WEI.toString(16)}` } });
    await expect(topUpGas(RPC, ACCOUNT, post)).resolves.toEqual({ ok: true, toppedUp: false });
    expect(bodies).toEqual([{ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [ACCOUNT, "latest"] }]);
  });

  it("reports a non-Anvil RPC by its method-not-found answer, naming the reason", async () => {
    const post: JsonRpcPost = async (_url, body) =>
      (body as { method?: unknown }).method === "eth_getBalance"
        ? { result: "0x0" }
        : { result: null, error: { code: -32601, message: "the method anvil_setBalance does not exist" } };
    await expect(topUpGas(RPC, ACCOUNT, post)).resolves.toEqual({
      ok: false,
      notAnvil: true,
      detail: "the method anvil_setBalance does not exist",
    });
  });

  it("refuses an Anvil error other than method-not-found as not the chain check", async () => {
    const post: JsonRpcPost = async (_url, body) =>
      (body as { method?: unknown }).method === "eth_getBalance"
        ? { result: "0x0" }
        : { result: null, error: { code: -32000, message: "missing trie node" } };
    await expect(topUpGas(RPC, ACCOUNT, post)).resolves.toEqual({ ok: false, notAnvil: false, detail: "missing trie node" });
  });

  it("throws when the balance answer is not hex", async () => {
    const post: JsonRpcPost = async () => ({ result: "0xzz" });
    await expect(topUpGas(RPC, ACCOUNT, post)).rejects.toThrow("answered eth_getBalance");
  });

  it("throws when the RPC answer is not a JSON-RPC response", async () => {
    const post: JsonRpcPost = async () => "not json";
    await expect(topUpGas(RPC, ACCOUNT, post)).rejects.toThrow("without a result");
  });
});

describe("the faucet's amounts", () => {
  it("mints 10,000 USDC and ensures 1 ETH of gas", () => {
    expect(FAUCET_USDC).toBe(10_000_000_000_000n);
    expect(FAUCET_GAS_WEI).toBe(1_000_000_000_000_000_000n);
  });
});
