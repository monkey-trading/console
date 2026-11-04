/** Tests for the dev-faucet action: gas top-up and mint through the pinned Anvil RPC, never the wallet, gated to live-dev builds. */

import { decodeFunctionData, parseAbi, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDeploy, type RawDeploy } from "../engine/deploy";
import vectors from "../engine/eip712-vectors.json";
import { settle } from "../engine/test-kit";
import { fundWithAnvil } from "./actions";
import { connected, VAULT } from "./live-kit";

const USDC = "0x00000000000000000000000000000000000000cc";
/** Anvil's first unlocked default account, which sends the mint. */
const ANVIL_0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const TX = `0x${"ab".repeat(32)}`;
const MINT = parseAbi(["function mint(address to, uint256 amount)"]);
/** An Anvil that mints: its accounts, the mint's hash, and a successful receipt. */
const MINTS = { eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { result: TX }, eth_getTransactionReceipt: { result: { status: "0x1" } } };
const methods = (bodies: unknown[]) => bodies.map((b) => (b as { method: string }).method);

const LIVE_DEV: RawDeploy = {
  mode: "live-dev",
  origin: "https://127.0.0.1:8080",
  chainId: String(vectors.chain_id),
  vault: VAULT,
  usdc: USDC,
  devOrigins: "https://127.0.0.1:8080",
  rpcUrl: "http://127.0.0.1:8545",
};

/** Stubs global fetch as the pinned RPC, answering each JSON-RPC method as `answers` says and recording bodies. */
function stubRpc(answers: Record<string, unknown>) {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { method?: string };
    bodies.push(body);
    const method = body.method ?? "";
    const answer = answers[method];
    if (answer === undefined) throw new Error(`unexpected RPC method ${method}`);
    return { ok: true, json: async () => answer } as Response;
  });
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe("fundWithAnvil", () => {
  it("tops gas up to 1 ETH and mints 10,000 USDC from Anvil's first unlocked account through the pinned RPC, never asking the wallet", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null }, ...MINTS });
    const { provider, store } = await connected();
    const funded = await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(funded).toBe(true);
    expect(methods(bodies)).toEqual(["eth_getBalance", "anvil_setBalance", "eth_accounts", "eth_sendTransaction", "eth_getTransactionReceipt"]);
    expect(bodies[1]).toEqual({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0xde0b6b3a7640000"] });
    const send = bodies[3] as { params: [{ from: string; to: string; data: Hex }] };
    expect({ from: send.params[0].from, to: send.params[0].to }).toEqual({ from: ANVIL_0, to: USDC });
    expect(decodeFunctionData({ abi: MINT, data: send.params[0].data })).toEqual({ functionName: "mint", args: [expect.stringMatching(/^0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266$/i), 10_000_000_000n] });
    // The wallet sends nothing and is asked nothing.
    expect(provider.sent).toEqual([]);
    expect(provider.calls.filter((call) => call.method === "eth_sendTransaction")).toEqual([]);
    expect(store.getSnapshot().notices).toEqual({}); // the wallet's balance shows the mint
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("mints without touching gas when the wallet already holds 1 ETH", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0xde0b6b3a7640000" }, ...MINTS });
    const { provider, store } = await connected();
    expect(await fundWithAnvil(store, parseDeploy(LIVE_DEV))).toBe(true);
    expect(methods(bodies)).toEqual(["eth_getBalance", "eth_accounts", "eth_sendTransaction", "eth_getTransactionReceipt"]);
    expect(provider.sent).toEqual([]);
  });

  it("refuses on a non-Anvil RPC before minting anything, naming the reason", async () => {
    const bodies = stubRpc({
      eth_getBalance: { result: "0x0" },
      // A JSON-RPC error answer carries no `result` key, as a real node's does.
      anvil_setBalance: { error: { code: -32601, message: "the method anvil_setBalance does not exist" } },
    });
    const { store } = await connected();
    expect(await fundWithAnvil(store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(methods(bodies)).not.toContain("eth_sendTransaction");
    expect(store.getSnapshot().notices.faucet?.text).toBe("The build's RPC is not an Anvil node (the method anvil_setBalance does not exist), so the faucet cannot fund this wallet.");
  });

  it("names an RPC that offers no unlocked account to mint from, or no eth_sendTransaction, as not Anvil", async () => {
    stubRpc({ eth_getBalance: { result: "0xde0b6b3a7640000" }, eth_accounts: { result: [] } });
    const first = await connected();
    expect(await fundWithAnvil(first.store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(first.store.getSnapshot().notices.faucet?.text).toBe("The build's RPC is not an Anvil node (it offers no unlocked account to send the mint from), so the faucet cannot fund this wallet.");
    stubRpc({ eth_getBalance: { result: "0xde0b6b3a7640000" }, eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { error: { code: -32601, message: "the method eth_sendTransaction does not exist" } } });
    const second = await connected();
    expect(await fundWithAnvil(second.store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(second.store.getSnapshot().notices.faucet?.text).toBe("The build's RPC is not an Anvil node (the method eth_sendTransaction does not exist), so the faucet cannot fund this wallet.");
  });

  it("reports an RPC that refuses the mint, and one whose mint reverts, at the control, and settles busy", async () => {
    stubRpc({ eth_getBalance: { result: "0xde0b6b3a7640000" }, eth_accounts: { result: [ANVIL_0] }, eth_sendTransaction: { error: { code: -32000, message: "insufficient funds for gas" } } });
    const refused = await connected();
    expect(await fundWithAnvil(refused.store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(refused.store.getSnapshot().notices.faucet).toMatchObject({ tone: "error", text: "The faucet could not mint USDC: insufficient funds for gas." });
    expect(refused.store.getSnapshot().busy).toBe(false);
    stubRpc({ eth_getBalance: { result: "0xde0b6b3a7640000" }, ...MINTS, eth_getTransactionReceipt: { result: { status: "0x0" } } });
    const reverted = await connected();
    expect(await fundWithAnvil(reverted.store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(reverted.store.getSnapshot().notices.faucet).toMatchObject({ tone: "error", text: "The faucet's mint reverted." });
    expect(reverted.store.getSnapshot().busy).toBe(false);
  });

  it("does nothing outside a live-dev build: no RPC, no mint, no notice", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null }, ...MINTS });
    const { provider, store } = await connected();
    expect(await fundWithAnvil(store, parseDeploy({ ...LIVE_DEV, mode: "live" }))).toBe(false);
    expect(bodies).toEqual([]);
    expect(provider.sent).toEqual([]);
    expect(store.getSnapshot().notices).toEqual({});
  });

  it("reports a balance read the RPC refuses, mints nothing, and settles busy and prompt", async () => {
    const bodies = stubRpc({ eth_getBalance: { error: { code: -32000, message: "missing trie node" } } });
    const { store } = await connected();
    expect(await fundWithAnvil(store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(methods(bodies)).toEqual(["eth_getBalance"]);
    expect(store.getSnapshot().notices).toMatchObject({ faucet: { tone: "error", text: "The chain's RPC answered with -32000: missing trie node." } });
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("refuses a read-only watched account, and no wallet, before asking the RPC anything", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null }, ...MINTS });
    const { store, wallet } = await connected();
    store.liveWallet = { ...wallet, readOnly: true };
    expect(await fundWithAnvil(store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(store.getSnapshot().notices.faucet).toMatchObject({ tone: "error", text: "The watched account is read-only, so the faucet cannot fund it." });
    store.liveWallet = null;
    expect(await fundWithAnvil(store, parseDeploy(LIVE_DEV))).toBe(false);
    expect(store.getSnapshot().notices.faucet).toMatchObject({ tone: "error", text: "Connect a wallet first." });
    expect(bodies).toEqual([]);
  });

  it("is false for a mint that lands after another wallet connected, and leaves the new connection's busy state alone", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: string }) => {
      const { method } = JSON.parse(init?.body ?? "{}") as { method: keyof typeof MINTS | "eth_getBalance" };
      bodies.push(method);
      if (method === "eth_getTransactionReceipt") await held;
      const answer = method === "eth_getBalance" ? { result: "0xde0b6b3a7640000" } : MINTS[method];
      return { ok: true, json: async () => answer } as Response;
    });
    const { store, wallet } = await connected();
    const funding = fundWithAnvil(store, parseDeploy(LIVE_DEV));
    await settle();
    store.liveWallet = { ...wallet }; // the next connection, which starts its own request
    store.patch({ busy: true });
    release();
    expect(await funding).toBe(false);
    expect(store.getSnapshot().busy).toBe(true);
    expect(bodies).toContain("eth_getTransactionReceipt");
  });

  it("tells the next connection nothing of a refusal that lands after it connected", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", async (_input: unknown, init?: { body?: string }) => {
      const { method } = JSON.parse(init?.body ?? "{}") as { method: string };
      if (method === "eth_sendTransaction") await held;
      const answer = method === "eth_getBalance" ? { result: "0xde0b6b3a7640000" } : method === "eth_accounts" ? { result: [ANVIL_0] } : { error: { code: -32000, message: "insufficient funds" } };
      return { ok: true, json: async () => answer } as Response;
    });
    const { store, wallet } = await connected();
    const funding = fundWithAnvil(store, parseDeploy(LIVE_DEV));
    await settle();
    store.liveWallet = { ...wallet };
    release();
    expect(await funding).toBe(false);
    expect(store.getSnapshot().notices).toEqual({});
  });
});
