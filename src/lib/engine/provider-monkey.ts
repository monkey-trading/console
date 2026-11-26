/**
 * The MONKEY minter's emissions transactions over an EIP-1193 provider: the `claimEmissions` call
 * and the chain reads that decide whether one is due. `provider-wallet.ts` delegates its wallet
 * interface's MONKEY methods here.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import { emissionsFailure } from "./claim-refusal";
import type { EntitlementProof } from "./emissions";
import { hexOf, type Eip1193Provider, type WalletChain } from "./provider-wallet";
import { WALLET_READ_MS, withinMs } from "./serialized-provider";
import type { Address } from "./types";
import type { Progress } from "./wallet";

const MINTER = parseAbi([
  "function claimEmissions(address account, uint256 entitled, uint64 checkpointSeq, bytes32[] siblings) returns (uint256)",
  "function emissionsClaimed(address account) view returns (uint256)",
  "function monkey() view returns (address)",
]);

const VAULT = parseAbi(["function latestSeq() view returns (uint64)"]);

/** What a build that names no minter says to a claim or a read. */
const NO_MINTER = "MONKEY claims are not currently available.";

/** The zero address, which a token that is not deployed would be named by. */
const NO_TOKEN = "0x0000000000000000000000000000000000000000";

/**
 * Offers to add `token` to the wallet so its balance shows there; resolves true only when the
 * wallet added it. Best-effort: no `token`, a wallet without `wallet_watchAsset`, or a user who
 * declines resolves false and nothing else changes.
 */
export async function suggestTokenAsset(ensureChain: () => Promise<void>, provider: Eip1193Provider, token: string | null, symbol: string, decimals: number): Promise<boolean> {
  if (token === null) return false;
  await ensureChain();
  try {
    const added: unknown = await provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: token, symbol, decimals } } });
    return added === true;
  } catch {
    return false;
  }
}

/**
 * Builds the minter's `claimEmissions` for `proof`, at the checkpoint its `seq` names, and sends it
 * to `minter` through `send`, which transmits the call and waits for it to be mined. The proof names
 * this account: the node signed it for the account's own route.
 * Error cases:
 * - the build names no minter, the proof is for another account, or there is nothing to claim
 * - the user declines, or the transaction reverts (said in plain words, see `emissionsFailure`) or is not confirmed after 180 receipt polls a second apart
 */
export async function claimEmissionsTx(
  address: Address,
  minter: string | null,
  send: (to: string, data: Hex, action: string, progress: Progress) => Promise<string>,
  proof: EntitlementProof,
  progress: Progress,
): Promise<string> {
  if (minter === null) throw new Error(NO_MINTER);
  if (proof.account.toLowerCase() !== address.toLowerCase()) throw new Error("This MONKEY belongs to another account, so it cannot be claimed from this wallet.");
  // `BigInt` throws on a malformed string; the enclave signed this shape for the account's route.
  const entitled = BigInt(proof.entitled);
  if (entitled <= 0n) throw new Error("There is no MONKEY to claim.");
  const data = encodeFunctionData({ abi: MINTER, functionName: "claimEmissions", args: [hexOf(address), entitled, BigInt(proof.seq), proof.siblings.map(hexOf)] });
  return send(minter, data, "claim your MONKEY emissions", progress).catch((error: unknown) => {
    throw emissionsFailure(error);
  });
}

/**
 * Reads the minter's record of this account's MONKEY, what it has minted against the entitlement
 * so far, and the seq of the vault's latest posted checkpoint, at or past which an entitlement
 * proof's claim works. A background read, like the payout one: the wallet is not asked
 * to switch chains, and the read is refused when it sits on another one.
 * Error cases:
 * - the build names no minter
 * - the wallet is on another chain than the deployment's
 */
export async function emissionsClaimedRead(address: Address, chain: WalletChain, provider: Eip1193Provider): Promise<{ claimed: bigint; latestSeq: number }> {
  const minter = chain.minter ?? null;
  if (minter === null) throw new Error(NO_MINTER);
  const current = Number(await withinMs(provider, { method: "eth_chainId" }, WALLET_READ_MS));
  if (current !== chain.chainId) throw new Error(`your wallet is connected to chain ${current}, not chain ${chain.chainId}`);
  const read = async (to: string, data: Hex) => hexOf(await withinMs(provider, { method: "eth_call", params: [{ to, data }, "latest"] }, WALLET_READ_MS));
  const claimedData = encodeFunctionData({ abi: MINTER, functionName: "emissionsClaimed", args: [hexOf(address)] });
  const claimed = decodeFunctionResult({ abi: MINTER, functionName: "emissionsClaimed", data: await read(minter, claimedData) });
  const seqData = encodeFunctionData({ abi: VAULT, functionName: "latestSeq" });
  const latestSeq = decodeFunctionResult({ abi: VAULT, functionName: "latestSeq", data: await read(chain.vault, seqData) });
  return { claimed, latestSeq: Number(latestSeq) };
}

/**
 * Offers to add the minter's MONKEY token to the wallet so its balance shows there; resolves true
 * only when the wallet added it. Best-effort like the USDC offer: a wallet without
 * `wallet_watchAsset`, a user who declines, or a build naming no minter resolves false and nothing
 * else changes.
 */
export async function suggestMonkeyToken(ensureChain: () => Promise<void>, chain: WalletChain, provider: Eip1193Provider): Promise<boolean> {
  const minter = chain.minter ?? null;
  if (minter === null) return false;
  await ensureChain();
  try {
    const data = encodeFunctionData({ abi: MINTER, functionName: "monkey" });
    const monkey = decodeFunctionResult({ abi: MINTER, functionName: "monkey", data: hexOf(await withinMs(provider, { method: "eth_call", params: [{ to: minter, data }, "latest"] }, WALLET_READ_MS)) });
    if (monkey === NO_TOKEN) return false;
    const added: unknown = await provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: monkey, symbol: "MONKEY", decimals: 18 } } });
    return added === true;
  } catch {
    return false;
  }
}
