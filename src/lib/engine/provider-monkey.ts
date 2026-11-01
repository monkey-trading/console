/**
 * The vault's MONKEY emissions transactions over an EIP-1193 provider: the `claimEmissions` call
 * and the chain reads that decide whether one is due. `provider-wallet.ts` delegates its wallet
 * interface's MONKEY methods here.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import type { EntitlementProof } from "./emissions";
import { hexOf, type Eip1193Provider, type WalletChain } from "./provider-wallet";
import type { Address } from "./types";
import type { Progress } from "./wallet";

const VAULT = parseAbi([
  "function claimEmissions(address account, uint256 entitled, bytes32[] siblings) returns (uint256)",
  "function emissionsClaimed(address account) view returns (uint256)",
  "function latestSeq() view returns (uint64)",
  "function monkey() view returns (address)",
]);

/** The vault that has not deployed its token yet names the zero address. */
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
 * Builds the vault's `claimEmissions` for `proof` and sends it through `sendVault`, which
 * transmits the call and waits for it to be mined. The proof names this account: the node signed
 * it for the account's own route.
 * Error cases:
 * - the proof is for another account or nothing to claim
 * - the user declines, or the transaction reverts or is not confirmed after 180 receipt polls a second apart
 */
export async function claimEmissionsTx(
  address: Address,
  sendVault: (data: Hex, action: string, progress: Progress) => Promise<string>,
  proof: EntitlementProof,
  progress: Progress,
): Promise<string> {
  if (proof.account.toLowerCase() !== address.toLowerCase()) throw new Error("The entitlement proof is for another account.");
  // `BigInt` throws on a malformed string; the enclave signed this shape for the account's route.
  const entitled = BigInt(proof.entitled);
  if (entitled <= 0n) throw new Error("The entitlement proof names nothing to claim.");
  const data = encodeFunctionData({ abi: VAULT, functionName: "claimEmissions", args: [hexOf(address), entitled, proof.siblings.map(hexOf)] });
  return sendVault(data, "claim your MONKEY emissions", progress);
}

/**
 * Reads the vault's own record of this account's MONKEY: what it has minted against the
 * entitlement so far, and the seq of its latest posted checkpoint, at or past which an
 * entitlement proof's claim works. A background read, like the payout one: the wallet is not asked
 * to switch chains, and the read is refused when it sits on another one.
 * Error cases:
 * - the wallet is on another chain than the deployment's
 */
export async function emissionsClaimedRead(address: Address, chain: WalletChain, provider: Eip1193Provider): Promise<{ claimed: bigint; latestSeq: number }> {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current !== chain.chainId) throw new Error(`your wallet is on chain ${current}, not chain ${chain.chainId}`);
  const read = async (data: Hex) => hexOf(await provider.request({ method: "eth_call", params: [{ to: chain.vault, data }, "latest"] }));
  const claimedData = encodeFunctionData({ abi: VAULT, functionName: "emissionsClaimed", args: [hexOf(address)] });
  const claimed = decodeFunctionResult({ abi: VAULT, functionName: "emissionsClaimed", data: await read(claimedData) });
  const seqData = encodeFunctionData({ abi: VAULT, functionName: "latestSeq" });
  const latestSeq = decodeFunctionResult({ abi: VAULT, functionName: "latestSeq", data: await read(seqData) });
  return { claimed, latestSeq: Number(latestSeq) };
}

/**
 * Offers to add the vault's MONKEY token to the wallet so its balance shows there; resolves true
 * only when the wallet added it. Best-effort like the USDC offer: a wallet without
 * `wallet_watchAsset`, a user who declines, or a vault naming no token resolves false and nothing
 * else changes.
 */
export async function suggestMonkeyToken(ensureChain: () => Promise<void>, chain: WalletChain, provider: Eip1193Provider): Promise<boolean> {
  await ensureChain();
  try {
    const data = encodeFunctionData({ abi: VAULT, functionName: "monkey" });
    const monkey = decodeFunctionResult({ abi: VAULT, functionName: "monkey", data: hexOf(await provider.request({ method: "eth_call", params: [{ to: chain.vault, data }, "latest"] })) });
    if (monkey === NO_TOKEN) return false;
    const added: unknown = await provider.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: monkey, symbol: "MONKEY", decimals: 18 } } });
    return added === true;
  } catch {
    return false;
  }
}
