/**
 * A dev build's check for a wallet transaction stuck behind a nonce left from an earlier chain
 * (monkey-trading/console#291). A browser wallet keeps the count of transactions it sent on a chain id,
 * so after the local chain is reset it sends with a nonce the fresh chain has not reached, and Anvil
 * holds that transaction for ever.
 */

import { rpc, rpcBody, type JsonRpcPost } from "./faucet";

/**
 * Whether transaction `hash` from `account` waits behind a nonce the chain has not reached: its nonce,
 * read from the pinned RPC, is above the account's count of mined transactions there. A read that
 * fails, or a transaction the RPC does not know, says no, so the wait goes on as before.
 */
export async function staleNonce(rpcUrl: string, post: JsonRpcPost, hash: string, account: string): Promise<boolean> {
  try {
    const sent = await rpc(post, rpcUrl, rpcBody("eth_getTransactionByHash", [hash]));
    const nonce = typeof sent === "object" && sent !== null && "nonce" in sent ? sent.nonce : null;
    if (typeof nonce !== "string" || !/^0x[0-9a-fA-F]+$/.test(nonce)) return false;
    const count = await rpc(post, rpcUrl, rpcBody("eth_getTransactionCount", [account, "latest"]));
    return typeof count === "string" && /^0x[0-9a-fA-F]+$/.test(count) && BigInt(nonce) > BigInt(count);
  } catch {
    return false;
  }
}
