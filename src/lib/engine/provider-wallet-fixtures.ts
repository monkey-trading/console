/** Shared fixtures for the provider-wallet tests: the stub chain, a wallet over a StubProvider, and calldata decoding. */

import { decodeFunctionData, parseAbi, type Hex } from "viem";

import vectors from "./eip712-vectors.json";
import { ProviderWallet, type WalletChain } from "./provider-wallet";
import { ACCOUNT, StubProvider, type StubOptions } from "./wallet-kit";

export const USDC = "0x00000000000000000000000000000000000000cc";
export const CHAIN: WalletChain = { chainId: vectors.chain_id, vault: vectors.vault, usdc: USDC, add: { name: "Anvil", rpcUrl: "http://127.0.0.1:8545/" } };

const ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit(uint256 amount) returns (uint256)",
  "function mint(address to, uint256 amount)",
  "struct Withdrawal { address account; uint256 amount; uint64 nonce; uint64 approvedSeq; uint64 signerEpoch; uint64 issuedAt; uint64 expiresAt; }",
  "function withdraw(Withdrawal withdrawal, uint64 checkpointSeq, bytes32[] siblings, bytes signature)",
]);

/** A wallet over a fresh StubProvider, on the stub chain. */
export function wallet(options: StubOptions = {}, chain: WalletChain = CHAIN) {
  const provider = new StubProvider(options);
  return { provider, wallet: new ProviderWallet(ACCOUNT, "Test wallet", provider, chain, { wait: async () => {} }) };
}

/** Decodes a transaction's calldata with the stub ABI. */
export const decode = (data: Hex) => decodeFunctionData({ abi: ABI, data });
