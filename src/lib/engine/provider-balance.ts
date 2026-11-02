/** The wallet's USDC balance on the deployment's chain, read through the wallet's own provider and never by asking it to switch chain. */

import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

import { USDC_UNIT } from "../vault";
import { withinMs } from "./serialized-provider";
import type { Eip1193Provider, WalletChain } from "./provider-wallet";
import { hexOf } from "./provider-wallet";
import type { UsdcBalance } from "./wallet";
import type { Address } from "./types";

const BALANCE_OF = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/** How long the wallet may take over each of the two calls, in milliseconds. */
export const BALANCE_CALL_MS = 8_000;

/**
 * `wrong_chain` when the wallet sits on another chain, which `eth_chainId` says before any call is made.
 * Error cases:
 * - the build names no USDC token, the wallet does not answer within `BALANCE_CALL_MS`, or it answers unreadably
 */
export async function usdcBalanceRead(address: Address, chain: WalletChain, provider: Eip1193Provider): Promise<UsdcBalance> {
  if (chain.usdc === null) throw new Error("This build names no USDC token.");
  const current = Number(await withinMs(provider, { method: "eth_chainId" }, BALANCE_CALL_MS));
  if (current !== chain.chainId) return { kind: "wrong_chain", chainId: current };
  const data = encodeFunctionData({ abi: BALANCE_OF, functionName: "balanceOf", args: [hexOf(address)] });
  const result = hexOf(await withinMs(provider, { method: "eth_call", params: [{ to: chain.usdc, data }, "latest"] }, BALANCE_CALL_MS));
  return { kind: "held", amount: decodeFunctionResult({ abi: BALANCE_OF, functionName: "balanceOf", data: result }) * USDC_UNIT };
}
