/** Tests for the dev-only faucet: its live-dev gating, the Anvil gas top-up's branches, and the RPC mint's. */

import { decodeFunctionData, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { parseDeploy, type RawDeploy } from "./deploy";
import { FAUCET_GAS_WEI, FAUCET_USDC, faucetAvailable, mintFromAnvil, topUpGas, type JsonRpcPost } from "./faucet";

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
        // A JSON-RPC error answer carries no `result` key, as a real node's does.
        : { error: { code: -32601, message: "the method anvil_setBalance does not exist" } };
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
        : { error: { code: -32000, message: "missing trie node" } };
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

  it("throws when the RPC's error member is not a well-formed JSON-RPC error, rather than reading it as success", async () => {
    const post: JsonRpcPost = async (_url, body) =>
      (body as { method?: unknown }).method === "eth_getBalance"
        ? { result: "0x0" }
        : { error: { code: "-32601", message: "method missing" } };
    await expect(topUpGas(RPC, ACCOUNT, post)).rejects.toThrow("malformed error");
  });
});

const USDC = "0x00000000000000000000000000000000000000cc";
const ANVIL_0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const TX = `0x${"ab".repeat(32)}`;
const MINT = parseAbi(["function mint(address to, uint256 amount)"]);
/** A wait that records each pause instead of sleeping. */
function waits() {
  const paused: number[] = [];
  return { paused, wait: async (ms: number) => void paused.push(ms) };
}

describe("mintFromAnvil", () => {
  it("sends the mint from Anvil's first unlocked account to the USDC, then reads receipts until one lands", async () => {
    let reads = 0;
    const bodies: unknown[] = [];
    const post: JsonRpcPost = async (_url, body) => {
      bodies.push(body);
      const { method } = body as { method: string };
      if (method === "eth_accounts") return { result: [ANVIL_0, ACCOUNT] };
      if (method === "eth_sendTransaction") return { result: TX };
      reads += 1;
      return { result: reads < 3 ? null : { status: "0x1" } };
    };
    const { paused, wait } = waits();
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, post, wait)).resolves.toEqual({ ok: true, hash: TX });
    const send = bodies[1] as { method: string; params: [{ from: string; to: string; data: Hex }] };
    expect(send.method).toBe("eth_sendTransaction");
    expect({ from: send.params[0].from, to: send.params[0].to }).toEqual({ from: ANVIL_0, to: USDC });
    expect(decodeFunctionData({ abi: MINT, data: send.params[0].data }).args).toEqual([expect.stringMatching(/^0x0+aa$/i), 10_000_000_000n]);
    expect(bodies.slice(2)).toEqual(Array(3).fill({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [TX] }));
    expect(paused).toEqual([500, 500]);
  });

  it("throws when the mint reverts, or when no receipt lands within its reads", async () => {
    const reverted = stub({ eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { result: TX }, eth_getTransactionReceipt: { result: { status: "0x0" } } });
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, reverted.post, waits().wait)).rejects.toThrow("The faucet's mint reverted.");
    const never = stub({ eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { result: TX }, eth_getTransactionReceipt: { result: null } });
    const { paused, wait } = waits();
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, never.post, wait)).rejects.toThrow("The faucet's mint was not confirmed in time.");
    expect(never.bodies).toHaveLength(32); // eth_accounts, eth_sendTransaction, then 30 reads
    expect(paused).toHaveLength(29);
  });

  it("reports a method-not-found, or no unlocked account, as not Anvil, and any other refusal by its message", async () => {
    const missing = stub({ eth_accounts: { error: { code: -32601, message: "Method not found" } } });
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, missing.post)).resolves.toEqual({ ok: false, notAnvil: true, detail: "Method not found" });
    const locked = stub({ eth_accounts: { result: [] } });
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, locked.post)).resolves.toEqual({ ok: false, notAnvil: true, detail: "it offers no unlocked account to send the mint from" });
    const refused = stub({ eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { error: { code: -32000, message: "insufficient funds for gas" } } });
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, refused.post)).resolves.toEqual({ ok: false, notAnvil: false, detail: "insufficient funds for gas" });
    expect(refused.bodies).toHaveLength(2);
  });

  it("throws on a send answer that is not a transaction hash, and refuses an amount that is not a positive whole base unit", async () => {
    const odd = stub({ eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { result: "0x1234" } });
    await expect(mintFromAnvil(RPC, USDC, ACCOUNT, FAUCET_USDC, odd.post)).rejects.toThrow("The chain's RPC answered eth_sendTransaction with 0x1234.");
    const none = stub({});
    for (const amount of [0n, -FAUCET_USDC, FAUCET_USDC + 1n]) {
      await expect(mintFromAnvil(RPC, USDC, ACCOUNT, amount, none.post)).rejects.toThrow("The faucet mints a positive whole number of USDC base units.");
    }
    expect(none.bodies).toEqual([]);
  });
});

describe("the faucet's amounts", () => {
  it("mints 10,000 USDC and ensures 1 ETH of gas", () => {
    expect(FAUCET_USDC).toBe(10_000_000_000_000n);
    expect(FAUCET_GAS_WEI).toBe(1_000_000_000_000_000_000n);
  });
});
