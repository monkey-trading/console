/** Tests for the dev-faucet action: gas top-up and mint through the connected wallet, gated to live-dev builds. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDeploy, type RawDeploy } from "../engine/deploy";
import vectors from "../engine/eip712-vectors.json";
import { fundWithAnvil } from "./actions";
import { connected, VAULT } from "./live-kit";

const USDC = "0x00000000000000000000000000000000000000cc";

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
  it("tops gas up to 1 ETH and mints 10,000 USDC through the connected wallet", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null } });
    const { provider, store } = await connected();
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(bodies).toEqual([
      { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "latest"] },
      { jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0xde0b6b3a7640000"] },
    ]);
    // The mint is a wallet transaction to the token; a regression that unbinds the wallet's method
    // throws instead and never sends this.
    const [mint] = provider.sent;
    expect(mint?.to).toBe(USDC);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("10,000 USDC minted and the wallet holds 1 ETH for gas. Deposit into the vault to trade it.");
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("mints without touching gas when the wallet already holds 1 ETH", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0xde0b6b3a7640000" } });
    const { provider, store } = await connected();
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(bodies.map((b) => (b as { method: string }).method)).toEqual(["eth_getBalance"]);
    expect(provider.sent).toHaveLength(1);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("10,000 USDC minted. Deposit into the vault to trade it.");
  });

  it("refuses on a non-Anvil RPC before minting anything, naming the reason", async () => {
    stubRpc({
      eth_getBalance: { result: "0x0" },
      // A JSON-RPC error answer carries no `result` key, as a real node's does.
      anvil_setBalance: { error: { code: -32601, message: "the method anvil_setBalance does not exist" } },
    });
    const { provider, store } = await connected();
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(provider.sent).toEqual([]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The build's RPC is not an Anvil node (the method anvil_setBalance does not exist), so the faucet cannot fund this wallet.");
  });

  it("does nothing outside a live-dev build: no RPC, no mint, no toast", async () => {
    const bodies = stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null } });
    const { provider, store } = await connected();
    await fundWithAnvil(store, parseDeploy({ ...LIVE_DEV, mode: "live" }));
    expect(bodies).toEqual([]);
    expect(provider.sent).toEqual([]);
    expect(store.getSnapshot().toasts).toEqual([]);
  });

  it("says so when the connected wallet has no faucet to mint from", async () => {
    stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null } });
    const { store, wallet } = await connected();
    store.liveWallet = { address: wallet.address, label: wallet.label, sign: wallet.sign, deposit: wallet.deposit, claim: wallet.claim };
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("This build's faucet is not available for the connected wallet.");
  });

  it("reports a balance read the RPC refuses, mints nothing, and settles busy and prompt", async () => {
    stubRpc({ eth_getBalance: { error: { code: -32000, message: "missing trie node" } } });
    const { provider, store } = await connected();
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(provider.sent).toEqual([]);
    const toasts = store.getSnapshot().toasts;
    expect(toasts.at(-1)?.text).toBe("The chain's RPC answered with -32000: missing trie node.");
    expect(toasts.some((t) => t.text.includes("minted"))).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("reports a declined mint after the gas top-up, and settles busy and prompt", async () => {
    stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null } });
    const { store } = await connected({ fail: { eth_sendTransaction: { code: 4001, message: "User rejected" } } });
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("You declined to mint USDC in your wallet.");
    expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
  });

  it("refuses a read-only watched account once, with the console's own reason and no faucet toast", async () => {
    stubRpc({ eth_getBalance: { result: "0x0" }, anvil_setBalance: { result: null } });
    const { provider, store, wallet } = await connected();
    store.liveWallet = { ...wallet, readOnly: true };
    store.patch({ wallet: { address: wallet.address, label: wallet.label, readOnly: true } });
    await fundWithAnvil(store, parseDeploy(LIVE_DEV));
    expect(provider.sent).toEqual([]);
    const toasts = store.getSnapshot().toasts;
    expect(toasts.at(-1)?.text).toBe("The console will not fund the wallet: this account is read-only, so nothing can be signed for it.");
    expect(toasts.filter((t) => t.text.includes("faucet is not available"))).toEqual([]);
  });
});
