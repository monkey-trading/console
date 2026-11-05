/**
 * A dev build's check for a wallet transaction stuck behind a nonce left from an earlier chain
 * (monkey-trading/console#291), and the move past it (monkey-trading/console#304). A browser wallet
 * keeps the count of transactions it sent on a chain id, so after the local chain is reset it sends
 * with a nonce the fresh chain has not reached, and Anvil holds that transaction for ever. On a local
 * Anvil chain the console drops it and sets the account's count past it, so the wallet counts that
 * nonce as used and its next send mines; it never does so on any other chain.
 */

import { METHOD_NOT_FOUND, rpc, rpcAllow, rpcBody, toQuantity, type JsonRpcPost } from "./faucet";
import type { StuckVerdict } from "./receipts";

const QUANTITY = /^0x[0-9a-fA-F]+$/;

/**
 * The nonce of transaction `hash` from `account` when it waits behind a nonce the chain has not
 * reached: its nonce, read from the pinned RPC, is above the account's count of mined transactions
 * there; null otherwise. A read that fails, or a transaction the RPC does not know, is null, so the
 * wait goes on as before.
 */
export async function staleNonce(rpcUrl: string, post: JsonRpcPost, hash: string, account: string): Promise<bigint | null> {
  try {
    const sent = await rpc(post, rpcUrl, rpcBody("eth_getTransactionByHash", [hash]));
    const nonce = typeof sent === "object" && sent !== null && "nonce" in sent ? sent.nonce : null;
    if (typeof nonce !== "string" || !QUANTITY.test(nonce)) return null;
    const count = await rpc(post, rpcUrl, rpcBody("eth_getTransactionCount", [account, "latest"]));
    return typeof count === "string" && QUANTITY.test(count) && BigInt(nonce) > BigInt(count) ? BigInt(nonce) : null;
  } catch {
    return null;
  }
}

/** Whether the pinned RPC says it is Anvil: its `web3_clientVersion` is `anvil/…`; null when it is, else why not. */
async function notAnvil(rpcUrl: string, post: JsonRpcPost): Promise<string | null> {
  const version = await rpcAllow(post, rpcUrl, rpcBody("web3_clientVersion", []));
  if (version.error !== null) return "the chain's RPC does not say what it is";
  return typeof version.result === "string" && /^anvil\//i.test(version.result) ? null : `the chain's RPC is not Anvil (it is ${String(version.result)})`;
}

/**
 * Moves `account` past its stuck transaction `hash` at `nonce` on the pinned RPC, once it says it is
 * Anvil: `anvil_dropTransaction(hash)`, then `anvil_setNonce(account, nonce + 1)`. The count goes past
 * the stuck nonce, not to it, as Anvil never promotes a queued transaction after `anvil_setNonce`.
 * The count only rises, so a wallet with several stuck nonces converges: each send that sticks moves
 * the count past its own nonce, and the next one the wallet sends is at or above it. A refusal is a
 * value saying why, and nothing is called after it.
 */
export async function movePastNonce(rpcUrl: string, post: JsonRpcPost, hash: string, account: string, nonce: bigint): Promise<Exclude<StuckVerdict, null>> {
  try {
    const why = await notAnvil(rpcUrl, post);
    if (why !== null) return { moved: false, why };
    const refused = (step: string, error: { code: number; message: string }) => ({
      moved: false as const,
      why: error.code === METHOD_NOT_FOUND ? "the chain's RPC is not Anvil" : `the chain's RPC refused to ${step}: ${error.message.replace(/\.+$/, "")}`,
    });
    const dropped = await rpcAllow(post, rpcUrl, rpcBody("anvil_dropTransaction", [hash]));
    if (dropped.error !== null) return refused("drop it", dropped.error);
    const set = await rpcAllow(post, rpcUrl, rpcBody("anvil_setNonce", [account, toQuantity(nonce + 1n)]));
    if (set.error !== null) return refused("move the account's count past it", set.error);
    return { moved: true };
  } catch (error) {
    return { moved: false, why: `the chain's RPC did not answer: ${error instanceof Error ? error.message.replace(/\.+$/, "") : String(error)}` };
  }
}

/** Whether `hash` from `account` is stuck behind a nonce from an earlier chain, and if so the move past it: null while it is not. */
export async function clearStaleNonce(rpcUrl: string, post: JsonRpcPost, hash: string, account: string): Promise<StuckVerdict> {
  const nonce = await staleNonce(rpcUrl, post, hash, account);
  return nonce === null ? null : movePastNonce(rpcUrl, post, hash, account, nonce);
}
