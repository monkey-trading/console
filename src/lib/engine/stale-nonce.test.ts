/** Tests that a dev build finds a wallet transaction stuck behind a nonce left from an earlier chain, instead of waiting for ever, and says what became of it (monkey-trading/console#291, #304). */

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDeploy, type RawDeploy } from "./deploy";
import type { JsonRpcPost } from "./faucet";
import { walletDeps } from "./live-session";
import { ProviderWallet } from "./provider-wallet";
import { MOVED_PAST, staleNonceText, waitMined } from "./receipts";
import { staleNonce } from "./stale-nonce";
import { ACCOUNT, StubProvider } from "./wallet-kit";

const RPC = "http://127.0.0.1:8545";
const HASH = `0x${"ab".repeat(32)}`;
const LIVE_DEV: RawDeploy = { mode: "live-dev", origin: "https://127.0.0.1:8080", chainId: "31337", vault: "0x5fbdb2315678afecb367f032d93f642f64180aa3", usdc: "0x00000000000000000000000000000000000000cc", devOrigins: "https://127.0.0.1:8080", rpcUrl: RPC };

/** A post stub that answers by method name and records every request body. */
function stub(answers: Record<string, unknown>) {
  const bodies: { method: string; params: unknown[] }[] = [];
  const post: JsonRpcPost = async (_url, body) => {
    bodies.push(body as { method: string; params: unknown[] });
    const { method } = body as { method: string };
    if (!(method in answers)) throw new Error(`unexpected ${method}`);
    return answers[method];
  };
  return { post, bodies };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staleNonce", () => {
  it("names the nonce of a transaction above the account's mined count, read from the pinned RPC", async () => {
    const { post, bodies } = stub({ eth_getTransactionByHash: { result: { nonce: "0x13" } }, eth_getTransactionCount: { result: "0x0" } });
    await expect(staleNonce(RPC, post, HASH, ACCOUNT)).resolves.toBe(19n);
    expect(bodies.map((b) => [b.method, b.params])).toEqual([["eth_getTransactionByHash", [HASH]], ["eth_getTransactionCount", [ACCOUNT, "latest"]]]);
  });

  it("names none for a nonce the chain has reached, a transaction the RPC does not know, a malformed answer or a failed read", async () => {
    await expect(staleNonce(RPC, stub({ eth_getTransactionByHash: { result: { nonce: "0x2" } }, eth_getTransactionCount: { result: "0x2" } }).post, HASH, ACCOUNT)).resolves.toBeNull();
    const unknown = stub({ eth_getTransactionByHash: { result: null } });
    await expect(staleNonce(RPC, unknown.post, HASH, ACCOUNT)).resolves.toBeNull();
    expect(unknown.bodies).toHaveLength(1);
    await expect(staleNonce(RPC, stub({ eth_getTransactionByHash: { result: { nonce: 19 } } }).post, HASH, ACCOUNT)).resolves.toBeNull();
    await expect(staleNonce(RPC, stub({ eth_getTransactionByHash: { result: { nonce: "0x13" } }, eth_getTransactionCount: { result: "lots" } }).post, HASH, ACCOUNT)).resolves.toBeNull();
    await expect(staleNonce(RPC, stub({ eth_getTransactionByHash: { error: { code: -32000, message: "down" } } }).post, HASH, ACCOUNT)).resolves.toBeNull();
    await expect(staleNonce(RPC, async () => { throw new Error("unreachable"); }, HASH, ACCOUNT)).resolves.toBeNull();
  });
});

describe("waitMined with a stale-nonce check", () => {
  const pending = (mineAt: number) => {
    let polls = 0;
    return async () => (polls++ < mineAt ? null : { status: "0x1" });
  };

  it("stops waiting at the second poll, saying the console moved past the nonce, or why it could not", async () => {
    const checks: number[] = [];
    const moved = async () => { checks.push(1); return { moved: true as const }; };
    await expect(waitMined(pending(Infinity), HASH, "deposit", async () => undefined, moved)).rejects.toThrow(MOVED_PAST);
    expect(checks).toHaveLength(1);
    const refused = async () => ({ moved: false as const, why: "the chain's RPC is not Anvil" });
    await expect(waitMined(pending(Infinity), HASH, "deposit", async () => undefined, refused)).rejects.toThrow(staleNonceText("the chain's RPC is not Anvil"));
    expect(staleNonceText("the chain's RPC is not Anvil")).toContain("Clear your wallet's activity data for this network");
  });

  it("goes on waiting while the check says no, and never asks for a transaction mined at once", async () => {
    let checks = 0;
    const stuck = async () => { checks += 1; return null; };
    await expect(waitMined(pending(3), HASH, "deposit", async () => undefined, stuck)).resolves.toBeUndefined();
    expect(checks).toBe(2);
    checks = 0;
    await expect(waitMined(pending(0), HASH, "deposit", async () => undefined, stuck)).resolves.toBeUndefined();
    expect(checks).toBe(0);
  });

  it("names a stuck deposit through the wallet, which asks the check about its own transaction and account", async () => {
    const asked: [string, string][] = [];
    const deps = { wait: async () => undefined, stuck: async (hash: string, account: string) => { asked.push([hash, account]); return { moved: true as const }; } };
    const wallet = new ProviderWallet(ACCOUNT, "Test wallet", new StubProvider({ balance: 10_000_000n, allowance: 10_000_000n, pendingReceipts: 1_000 }), { chainId: 31337, vault: LIVE_DEV.vault ?? "", usdc: LIVE_DEV.usdc ?? null, add: null }, deps);
    await expect(wallet.deposit(10_000_000_000n)).rejects.toThrow(MOVED_PAST);
    expect(asked).toEqual([[`0x${"1".padStart(64, "0")}`, ACCOUNT]]);
  });
});

describe("walletDeps", () => {
  const wait = async () => undefined;

  it("checks for a stale nonce, and moves past it, through the pinned RPC in a live-dev build only", async () => {
    const bodies: string[] = [];
    const answers: Record<string, unknown> = { eth_getTransactionByHash: { result: { nonce: "0x13" } }, eth_getTransactionCount: { result: "0x0" }, web3_clientVersion: { result: "anvil/v1.4.3" }, anvil_dropTransaction: { result: HASH }, anvil_setNonce: { result: null } };
    vi.stubGlobal("fetch", async (url: unknown, init?: { body?: string }) => {
      const { method } = JSON.parse(init?.body ?? "{}") as { method: string };
      bodies.push(`${String(url)} ${method}`);
      return { ok: true, json: async () => answers[method] } as Response;
    });
    const dev = walletDeps(parseDeploy(LIVE_DEV), wait);
    await expect(dev.stuck?.(HASH, ACCOUNT)).resolves.toEqual({ moved: true });
    expect(bodies).toEqual(["eth_getTransactionByHash", "eth_getTransactionCount", "web3_clientVersion", "anvil_dropTransaction", "anvil_setNonce"].map((method) => `${RPC}/ ${method}`));
    expect(walletDeps(parseDeploy({ ...LIVE_DEV, mode: "live" }), wait)).toEqual({ wait });
    expect(walletDeps(parseDeploy({ ...LIVE_DEV, rpcUrl: undefined }), wait)).toEqual({ wait });
  });
});
