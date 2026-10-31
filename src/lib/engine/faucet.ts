/**
 * The dev-only faucet (monkey-trading/console#44): in a `live-dev` build the Funding drawer can fund
 * the connected wallet from Anvil — `anvil_setBalance` on the build's pinned RPC tops up gas, and
 * the wallet itself sends the mock USDC's permissionless `mint`. Production and mock builds carry no
 * faucet at all. Nothing here touches the engine node; a non-Anvil RPC is reported, never guessed at.
 */

import { fixedFromInt, type Fixed } from "../fixed";
import type { Deploy } from "./deploy";
import type { Address } from "./types";

/** The demo amount the faucet mints: 10,000 USDC. */
export const FAUCET_USDC: Fixed = fixedFromInt(10_000);

/** The gas balance the faucet ensures, in wei: 1 ETH. */
export const FAUCET_GAS_WEI = 1_000_000_000_000_000_000n;

/** A JSON-RPC POST: `body` is the request object, the answer is the decoded response body. */
export type JsonRpcPost = (url: string, body: unknown) => Promise<unknown>;

/** Whether this build shows the faucet: a live-dev deployment naming the mock USDC and the Anvil RPC. */
export function faucetAvailable(deploy: Deploy): boolean {
  return deploy.mode === "live-dev" && deploy.usdc !== null && deploy.rpcUrl !== null;
}

/** JSON-RPC's code for a method the node does not have; Anvil answers every other node with it for `anvil_setBalance`. */
const METHOD_NOT_FOUND = -32601;

/** A JSON-RPC 2.0 request body; Anvil's server answers a body without the version field with an empty 204, not a result. */
function rpcBody(method: string, params: readonly unknown[]): unknown {
  return { jsonrpc: "2.0", id: 1, method, params };
}

/** The outcome of the gas top-up; a refusal is a value, not an exception. */
export type GasTopUp = { ok: true; toppedUp: boolean } | { ok: false; notAnvil: boolean; detail: string };

/**
 * Ensures `address` holds at least 1 ETH for gas, reading the balance and raising it with
 * `anvil_setBalance` only when it is short. An RPC that answers the setBalance with "method not
 * found" is not Anvil; the refusal names that so the caller says so instead of guessing.
 * Error cases:
 * - the RPC is unreachable, answers unparseably, or returns an error other than method-not-found
 */
export async function topUpGas(rpcUrl: string, address: Address, post: JsonRpcPost): Promise<GasTopUp> {
  const balance = await rpc(post, rpcUrl, rpcBody("eth_getBalance", [address, "latest"]));
  if (typeof balance !== "string" || !/^0x[0-9a-fA-F]+$/.test(balance)) throw new Error(`The chain's RPC answered eth_getBalance with ${String(balance)}.`);
  if (BigInt(balance) >= FAUCET_GAS_WEI) return { ok: true, toppedUp: false };
  const set = await rpcAllow(post, rpcUrl, rpcBody("anvil_setBalance", [address, toQuantity(FAUCET_GAS_WEI)]));
  if (set.error !== null) {
    const notAnvil = set.error.code === METHOD_NOT_FOUND;
    return { ok: false, notAnvil, detail: set.error.message };
  }
  return { ok: true, toppedUp: true };
}

/** `n` as a `0x` quantity, as JSON-RPC encodes it. */
function toQuantity(n: bigint): string {
  return `0x${n.toString(16)}`;
}

/** The JSON-RPC error shape, when the answer carries one. */
function rpcError(body: unknown): { code: number; message: string } | null {
  if (typeof body !== "object" || body === null || !("error" in body) || typeof body.error !== "object" || body.error === null) return null;
  if (!("code" in body.error) || !("message" in body.error)) return null;
  const { code, message } = body.error;
  if (typeof code !== "number" || typeof message !== "string") return null;
  return { code, message };
}

/** The answer's `result`; the error shape, when there is one, becomes an exception. Error cases: the answer is not a JSON-RPC response. */
async function rpc(post: JsonRpcPost, url: string, body: unknown): Promise<unknown> {
  const out = await rpcAllow(post, url, body);
  if (out.error !== null) throw new Error(`The chain's RPC answered with ${out.error.code}: ${out.error.message}.`);
  return out.result;
}

/** The answer's `result` and error as values, so a caller can classify a refusal itself. An error answer carries no `result` key, so either field admits the response; an `error` member that is not a well-formed JSON-RPC error means the answer is not a JSON-RPC response. Error cases: the answer is not a JSON-RPC response. */
async function rpcAllow(post: JsonRpcPost, url: string, body: unknown): Promise<{ result: unknown; error: { code: number; message: string } | null }> {
  const response = await post(url, body);
  if (typeof response !== "object" || response === null || (!("result" in response) && !("error" in response))) {
    throw new Error(`The chain's RPC answered without a result: ${String(response)}.`);
  }
  const error = rpcError(response);
  if ("error" in response && error === null) throw new Error(`The chain's RPC answered with a malformed error: ${String(response)}.`);
  return { result: "result" in response ? response.result : null, error };
}
