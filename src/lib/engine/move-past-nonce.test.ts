/**
 * Tests that a dev build moves a wallet past a nonce left from an earlier chain on a local Anvil chain,
 * in order and converging over several stuck nonces, and never on any other chain (monkey-trading/console#304).
 */

import { describe, expect, it } from "vitest";

import type { JsonRpcPost } from "./faucet";
import { clearStaleNonce, movePastNonce } from "./stale-nonce";
import { ACCOUNT } from "./wallet-kit";

const RPC = "http://127.0.0.1:28545";
const HASH = `0x${"ab".repeat(32)}`;
const quantity = (n: bigint) => `0x${n.toString(16)}`;

/** A post stub that answers by method name and records every request. */
function stub(answers: Record<string, unknown>) {
  const calls: [string, unknown[]][] = [];
  const post: JsonRpcPost = async (_url, body) => {
    const { method, params } = body as { method: string; params: unknown[] };
    calls.push([method, params]);
    if (!(method in answers)) throw new Error(`unexpected ${method}`);
    return answers[method];
  };
  return { post, calls };
}

/**
 * A local Anvil chain for one account, as its RPC answers: a transaction at the account's count
 * mines at once, one above it waits in the pool, and `anvil_setNonce` never promotes one that waits.
 * The wallet sends at its own next nonce or the chain's count, whichever is higher, as browser
 * wallets do, so one reset leaves it ahead of the chain.
 */
function anvil(count: bigint, walletNext: bigint) {
  const pool = new Map<string, bigint>();
  const mined = new Map<string, bigint>();
  const chain = { count, walletNext };
  const post: JsonRpcPost = async (_url, body) => {
    const { method, params } = body as { method: string; params: unknown[] };
    const hash = params[0] as string;
    switch (method) {
      case "eth_getTransactionByHash": {
        const nonce = pool.get(hash) ?? mined.get(hash);
        return { result: nonce === undefined ? null : { nonce: quantity(nonce) } };
      }
      case "eth_getTransactionCount": return { result: quantity(chain.count) };
      case "web3_clientVersion": return { result: "anvil/v1.4.3" };
      case "anvil_dropTransaction": return { result: pool.delete(hash) ? hash : null };
      case "anvil_setNonce": chain.count = BigInt(params[1] as string); return { result: null };
      default: throw new Error(`unexpected ${method}`);
    }
  };
  /** The wallet sends one transaction: its hash and whether it mined. */
  const send = () => {
    const nonce = chain.walletNext > chain.count ? chain.walletNext : chain.count;
    chain.walletNext = nonce + 1n;
    const hash = `0x${nonce.toString(16).padStart(64, "0")}`;
    if (nonce === chain.count) {
      mined.set(hash, nonce);
      chain.count += 1n;
      return { hash, mined: true };
    }
    pool.set(hash, nonce);
    return { hash, mined: false };
  };
  return { post, send, chain, pool };
}

describe("movePastNonce", () => {
  it("asks the pinned RPC what it is, then drops the stuck transaction and sets the count past its nonce", async () => {
    const { post, calls } = stub({ web3_clientVersion: { result: "anvil/v1.4.3" }, anvil_dropTransaction: { result: HASH }, anvil_setNonce: { result: null } });
    await expect(movePastNonce(RPC, post, HASH, ACCOUNT, 33n)).resolves.toEqual({ moved: true });
    expect(calls).toEqual([["web3_clientVersion", []], ["anvil_dropTransaction", [HASH]], ["anvil_setNonce", [ACCOUNT, "0x22"]]]);
  });

  it("calls nothing of Anvil's on an RPC that is not Anvil or does not say what it is, and says why", async () => {
    const geth = stub({ web3_clientVersion: { result: "Geth/v1.14.11-stable/linux-amd64/go1.23.2" } });
    await expect(movePastNonce(RPC, geth.post, HASH, ACCOUNT, 33n)).resolves.toEqual({ moved: false, why: "the chain's RPC is not Anvil (it is Geth/v1.14.11-stable/linux-amd64/go1.23.2)" });
    expect(geth.calls.map(([method]) => method)).toEqual(["web3_clientVersion"]);
    const silent = stub({ web3_clientVersion: { error: { code: -32601, message: "Method not found" } } });
    await expect(movePastNonce(RPC, silent.post, HASH, ACCOUNT, 33n)).resolves.toEqual({ moved: false, why: "the chain's RPC does not say what it is" });
    expect(silent.calls).toHaveLength(1);
  });

  it("stops at the first refusal, and says why", async () => {
    const lacking = stub({ web3_clientVersion: { result: "anvil/v1.4.3" }, anvil_dropTransaction: { error: { code: -32601, message: "Method not found" } } });
    await expect(movePastNonce(RPC, lacking.post, HASH, ACCOUNT, 33n)).resolves.toEqual({ moved: false, why: "the chain's RPC is not Anvil" });
    expect(lacking.calls.map(([method]) => method)).toEqual(["web3_clientVersion", "anvil_dropTransaction"]);
    const refusing = stub({ web3_clientVersion: { result: "anvil/v1.4.3" }, anvil_dropTransaction: { result: HASH }, anvil_setNonce: { error: { code: -32603, message: "nonce too low." } } });
    await expect(movePastNonce(RPC, refusing.post, HASH, ACCOUNT, 33n)).resolves.toEqual({ moved: false, why: "the chain's RPC refused to move the account's count past it: nonce too low" });
    await expect(movePastNonce(RPC, async () => { throw new Error("the chain's RPC answered HTTP 502"); }, HASH, ACCOUNT, 33n)).resolves.toEqual({ moved: false, why: "the chain's RPC did not answer: the chain's RPC answered HTTP 502" });
  });
});

describe("clearStaleNonce", () => {
  it("leaves a transaction the chain can mine alone, calling nothing of Anvil's", async () => {
    const { post, calls } = stub({ eth_getTransactionByHash: { result: { nonce: "0x2" } }, eth_getTransactionCount: { result: "0x2" } });
    await expect(clearStaleNonce(RPC, post, HASH, ACCOUNT)).resolves.toBeNull();
    expect(calls.map(([method]) => method)).toEqual(["eth_getTransactionByHash", "eth_getTransactionCount"]);
  });

  it("moves a wallet one reset left ahead past its stuck nonce, so its next send mines", async () => {
    const chain = anvil(0n, 33n);
    const stuck = chain.send();
    expect(stuck.mined).toBe(false);
    await expect(clearStaleNonce(RPC, chain.post, stuck.hash, ACCOUNT)).resolves.toEqual({ moved: true });
    expect(chain.chain.count).toBe(34n);
    expect(chain.send().mined).toBe(true);
  });

  it("converges over two stuck nonces: each send that sticks moves the count past its own, until one mines", async () => {
    // Two approvals already wait at 33 and 34 from before the reset; the wallet waits on the first.
    const chain = anvil(0n, 33n);
    const first = chain.send();
    chain.send();
    const counts: bigint[] = [];
    let waitingOn = first.hash;
    let sends = 0;
    for (;;) {
      await expect(clearStaleNonce(RPC, chain.post, waitingOn, ACCOUNT)).resolves.toEqual({ moved: true });
      counts.push(chain.chain.count);
      const next = chain.send();
      sends += 1;
      if (next.mined) break;
      expect(sends).toBeLessThan(3);
      waitingOn = next.hash;
    }
    // Past 33; 34 waits and is never promoted, so the next send at 35 sticks and is moved past too.
    expect(counts).toEqual([34n, 36n]);
    expect(sends).toBe(2);
  });
});
