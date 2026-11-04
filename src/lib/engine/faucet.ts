/**
 * The dev-only faucet (monkey-trading/console#44, #290): in a `live-dev` build the Funding page and
 * the setup popup can fund the connected wallet from Anvil, all through the build's pinned RPC:
 * `anvil_setBalance` tops up gas, and one of Anvil's unlocked accounts sends the mock USDC's
 * permissionless `mint`, so the wallet is never asked and its per-site permissions do not matter.
 * Production and mock builds carry no faucet at all. Nothing here touches the engine node; a
 * non-Anvil RPC is reported, never guessed at.
 */

import { encodeFunctionData, parseAbi, type Hex } from "viem";

import { fixedFromInt, type Fixed } from "../fixed";
import { USDC_UNIT } from "../vault";
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

/** The mock USDC's mint, which anyone may call: the local stack's MockUSDC (engine `contracts/test/mocks/MockUSDC.sol`). */
const MINT = parseAbi(["function mint(address to, uint256 amount)"]);

/** Receipt reads before a mint counts as unconfirmed, and the wait between them; Anvil mines each transaction as it arrives, so the first read normally finds it. */
const RECEIPT_READS = 30;
const RECEIPT_WAIT_MS = 500;

/** A JSON-RPC 2.0 request body; Anvil's server answers a body without the version field with an empty 204, not a result. */
export function rpcBody(method: string, params: readonly unknown[]): unknown {
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

/** The outcome of the mint; a refusal is a value, not an exception. */
export type FaucetMint = { ok: true; hash: string } | { ok: false; notAnvil: boolean; detail: string };

/** Waits `ms`; a test passes one that does not. */
export type Sleep = (ms: number) => Promise<void>;

const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mints `amount` of the mock USDC at `usdc` to `to` through the pinned RPC, and waits for the
 * receipt. The token's mint takes no permission, so Anvil sends it from the first of its unlocked
 * default accounts (`eth_accounts`), and the wallet is never asked. An RPC that offers no unlocked
 * account, or answers `eth_accounts` or `eth_sendTransaction` with "method not found", is not Anvil;
 * the refusal names that so the caller says so instead of guessing.
 * Error cases:
 * - `amount` is not a positive whole number of USDC base units
 * - the RPC is unreachable or answers unparseably, or a receipt read fails
 * - the mint reverts, or no receipt arrives within the reads
 */
export async function mintFromAnvil(rpcUrl: string, usdc: Address, to: Address, amount: Fixed, post: JsonRpcPost, wait: Sleep = sleep): Promise<FaucetMint> {
  if (amount <= 0n || amount % USDC_UNIT !== 0n) throw new Error("The faucet mints a positive whole number of USDC base units.");
  const accounts = await rpcAllow(post, rpcUrl, rpcBody("eth_accounts", []));
  if (accounts.error !== null) return { ok: false, notAnvil: accounts.error.code === METHOD_NOT_FOUND, detail: accounts.error.message };
  const from: unknown = Array.isArray(accounts.result) ? accounts.result[0] : undefined;
  if (typeof from !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(from)) return { ok: false, notAnvil: true, detail: "it offers no unlocked account to send the mint from" };
  const data = encodeFunctionData({ abi: MINT, functionName: "mint", args: [to as Hex, amount / USDC_UNIT] });
  const sent = await rpcAllow(post, rpcUrl, rpcBody("eth_sendTransaction", [{ from, to: usdc, data }]));
  if (sent.error !== null) return { ok: false, notAnvil: sent.error.code === METHOD_NOT_FOUND, detail: sent.error.message };
  const hash = sent.result;
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`The chain's RPC answered eth_sendTransaction with ${String(hash)}.`);
  for (let read = 1; read <= RECEIPT_READS; read += 1) {
    const receipt = await rpc(post, rpcUrl, rpcBody("eth_getTransactionReceipt", [hash]));
    if (typeof receipt === "object" && receipt !== null && "status" in receipt) {
      if (receipt.status !== "0x1") throw new Error("The faucet's mint reverted.");
      return { ok: true, hash };
    }
    if (read < RECEIPT_READS) await wait(RECEIPT_WAIT_MS);
  }
  throw new Error("The faucet's mint was not confirmed in time.");
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
export async function rpc(post: JsonRpcPost, url: string, body: unknown): Promise<unknown> {
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

/** POSTs one JSON-RPC request to the pinned RPC and resolves with the decoded body. Error cases: the RPC answers not-OK. */
export const postJsonRpc: JsonRpcPost = async (url, body) => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`the chain's RPC answered HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
};
