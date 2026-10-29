/**
 * A `Wallet` over any EIP-1193 provider, an injected browser wallet or a WalletConnect session: it
 * keeps the wallet on the deployment's chain, signs the engine's typed data with
 * `eth_signTypedData_v4`, and sends the vault's deposit and claim transactions. Chain reads go
 * through the same provider, so nothing but the wallet's own chain provider sees them.
 */

import { decodeFunctionResult, encodeFunctionData, getTypesForEIP712Domain, isHex, parseAbi, recoverTypedDataAddress, serializeTypedData, type Hex } from "viem";

import { fixedFromWire, type Fixed } from "../fixed";
import { isWholeUsdc, USDC_UNIT } from "../vault";
import type { TypedRequest } from "./eip712";
import type { Address, SignedWithdrawal } from "./types";
import type { Progress, SignRequest, Wallet } from "./wallet";

/** The part of an EIP-1193 provider the wallet uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

/** The deployment the wallet acts on. */
export interface WalletChain {
  chainId: number;
  vault: string;
  /** The USDC token the vault takes; null when the build names none, and then deposits are refused. */
  usdc: string | null;
  /** A name and RPC URL to offer the wallet when it does not know the chain, such as a local Anvil chain; null when it must know it. */
  add: { name: string; rpcUrl: string } | null;
}

export interface ProviderWalletDeps {
  /** Resolves after `ms` milliseconds; the wallet polls for receipts with it. */
  wait(ms: number): Promise<void>;
  /** Ends the wallet's connection, such as a WalletConnect session; absent when there is nothing to end. */
  disconnect?: () => Promise<void>;
}

const ERC20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const VAULT = parseAbi([
  "function deposit(uint256 amount) returns (uint256)",
  "struct Withdrawal { address account; uint256 amount; uint64 nonce; uint64 approvedSeq; uint64 signerEpoch; uint64 issuedAt; uint64 expiresAt; }",
  "function withdraw(Withdrawal withdrawal, uint64 checkpointSeq, bytes32[] siblings, bytes signature)",
  "function usedNonces(address account, uint64 nonce) view returns (bool)",
]);

/** EIP-1193's code for a request the user rejected, and EIP-3085's for a chain the wallet does not know. */
const USER_REJECTED = 4001;
const UNKNOWN_CHAIN = 4902;
/** How often, and how many times, the wallet polls for a transaction's receipt. */
const RECEIPT_POLL_MS = 1_000;
const RECEIPT_POLLS = 180;
const NO_TRANSACTION = `0x${"0".repeat(64)}`;

const hex = (n: number) => `0x${n.toString(16)}`;
const errorCode = (error: unknown) => (typeof error === "object" && error !== null && "code" in error ? error.code : undefined);

/** `value` as `0x` hex, as viem's encoders take it. Error cases: it is not hex, which a wallet or the node answered wrongly. */
function hexOf(value: unknown): Hex {
  if (typeof value !== "string" || !isHex(value)) throw new Error(`Expected 0x hex, got ${String(value)}.`);
  return value;
}

/** The error a wallet's refusal stands for, written for the user. */
function walletError(error: unknown, action: string): Error {
  if (errorCode(error) === USER_REJECTED) return new Error(`You declined to ${action} in your wallet.`, { cause: error });
  const detail = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  return new Error(`Your wallet could not ${action}: ${detail}`, { cause: error });
}

/** USDC base units for `amount`, which must be a whole number of them. */
function usdcUnits(amount: Fixed): bigint {
  if (amount <= 0n || !isWholeUsdc(amount)) throw new Error("The amount must be a positive whole number of USDC base units (six decimal places).");
  return amount / USDC_UNIT;
}

/** Normalises a 65-byte signature's `v` to 27 or 28, as the engine reads it; some wallets return 0 or 1. */
export function normaliseSignature(signature: string): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("The wallet returned a signature that is not 65 bytes.");
  const v = parseInt(signature.slice(130), 16);
  const fixed = v === 0 || v === 1 ? v + 27 : v;
  if (fixed !== 27 && fixed !== 28) throw new Error("The wallet returned a signature with an unknown recovery id.");
  return hexOf(`${signature.slice(0, 130)}${fixed.toString(16)}`);
}

export class ProviderWallet implements Wallet {
  constructor(
    readonly address: Address,
    readonly label: string,
    private readonly provider: Eip1193Provider,
    private readonly chain: WalletChain,
    private readonly deps: ProviderWalletDeps,
  ) {}

  /**
   * Puts the wallet on the deployment's chain, offering to add a chain it does not know when the
   * build names its RPC URL.
   * Error cases:
   * - the user declines, or the wallet stays on another chain
   */
  async ensureChain(): Promise<void> {
    const current = Number(await this.provider.request({ method: "eth_chainId" }));
    if (current === this.chain.chainId) return;
    const chainId = hex(this.chain.chainId);
    try {
      await this.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      if (errorCode(error) !== UNKNOWN_CHAIN || this.chain.add === null) throw walletError(error, `switch to chain ${this.chain.chainId}`);
      const { name, rpcUrl } = this.chain.add;
      try {
        await this.provider.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: name, rpcUrls: [rpcUrl], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }] });
      } catch (cause) {
        throw walletError(cause, `add chain ${this.chain.chainId}`);
      }
    }
    const after = Number(await this.provider.request({ method: "eth_chainId" }));
    if (after !== this.chain.chainId) throw new Error(`Your wallet is on chain ${after}; switch it to chain ${this.chain.chainId} to continue.`);
  }

  /**
   * Error cases:
   * - the request is for another chain or vault than the deployment's, or the wallet is on another chain
   * - the user declines, or the wallet returns a signature that does not recover to this account
   */
  async sign(request: SignRequest): Promise<string> {
    const { domain } = request.typed;
    if (domain.chainId !== this.chain.chainId || domain.verifyingContract.toLowerCase() !== this.chain.vault.toLowerCase()) {
      throw new Error("The request names another chain or vault than this deployment's, so it was not signed.");
    }
    await this.ensureChain();
    let signature: Hex;
    try {
      // A wallet hashes the domain with the `EIP712Domain` fields the typed data lists, and viem serializes only those.
      const withDomain = { ...request.typed, types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...request.typed.types } };
      const raw = await this.provider.request({ method: "eth_signTypedData_v4", params: [this.address, serializeTypedData(viemTyped(withDomain))] });
      signature = normaliseSignature(String(raw));
    } catch (error) {
      throw walletError(error, "sign");
    }
    const signer = await recoverTypedDataAddress({ ...viemTyped(request.typed), signature });
    if (signer.toLowerCase() !== this.address) throw new Error("The wallet signed with another account than the connected one, so the signature was not sent.");
    return signature;
  }

  /**
   * Error cases:
   * - the build names no USDC token, or the amount is not a positive whole number of USDC base units, or exceeds the wallet's USDC
   * - the user declines a transaction, or one reverts or is not confirmed after 180 receipt polls a second apart
   */
  async deposit(amount: Fixed, progress: Progress = () => undefined): Promise<string> {
    const units = usdcUnits(amount);
    const usdc = this.chain.usdc;
    if (usdc === null) throw new Error("This build names no USDC token, so it cannot deposit.");
    await this.ensureChain();
    const owner = hexOf(this.address);
    const vault = hexOf(this.chain.vault);
    const balance = await this.read(usdc, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [owner] }), "balanceOf");
    if (balance < units) throw new Error("Your wallet holds less USDC than that.");
    const allowance = await this.read(usdc, encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [owner, vault] }), "allowance");
    if (allowance < units) await this.send(usdc, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [vault, units] }), "approve the vault", progress);
    return this.send(this.chain.vault, encodeFunctionData({ abi: VAULT, functionName: "deposit", args: [units] }), "deposit", progress);
  }

  /**
   * Error cases:
   * - the authorization is for another account or deployment, or has no typed authorization
   * - the user declines, or the transaction reverts or is not confirmed after 180 receipt polls a second apart
   */
  async claim(withdrawal: SignedWithdrawal, progress: Progress = () => undefined): Promise<string> {
    const auth = withdrawal.authorization;
    if (auth === undefined || withdrawal.approved_seq === undefined) throw new Error("This withdrawal has no authorization to claim yet.");
    if (withdrawal.account.toLowerCase() !== this.address || withdrawal.chain_id !== this.chain.chainId || withdrawal.vault.toLowerCase() !== this.chain.vault.toLowerCase()) {
      throw new Error("The authorization is for another account or deployment.");
    }
    await this.ensureChain();
    const data = encodeFunctionData({
      abi: VAULT, functionName: "withdraw",
      args: [
        { account: hexOf(this.address), amount: usdcUnits(fixedFromWire(withdrawal.amount)), nonce: BigInt(withdrawal.nonce), approvedSeq: BigInt(withdrawal.approved_seq), signerEpoch: BigInt(auth.signer_epoch), issuedAt: BigInt(auth.issued_at), expiresAt: BigInt(auth.expires_at) },
        BigInt(auth.checkpoint_seq), auth.siblings.map(hexOf), hexOf(withdrawal.signature),
      ],
    });
    return this.send(this.chain.vault, data, "claim the withdrawal", progress);
  }

  /** Ends the wallet's connection where it has one to end. */
  async disconnect(): Promise<void> {
    await this.deps.disconnect?.();
  }

  /**
   * Whether the vault has paid this account's payout `nonce`. A read in the background, so a wallet
   * on another chain is not asked to switch; the read is refused instead.
   * Error cases:
   * - the wallet is on another chain than the deployment's
   */
  async claimed(nonce: number): Promise<boolean> {
    const current = Number(await this.provider.request({ method: "eth_chainId" }));
    if (current !== this.chain.chainId) throw new Error(`your wallet is on chain ${current}, not chain ${this.chain.chainId}`);
    const data = encodeFunctionData({ abi: VAULT, functionName: "usedNonces", args: [hexOf(this.address), BigInt(nonce)] });
    const result = hexOf(await this.provider.request({ method: "eth_call", params: [{ to: this.chain.vault, data }, "latest"] }));
    return decodeFunctionResult({ abi: VAULT, functionName: "usedNonces", data: result });
  }

  private async read(to: string, data: Hex, functionName: "balanceOf" | "allowance"): Promise<bigint> {
    const result = hexOf(await this.provider.request({ method: "eth_call", params: [{ to, data }, "latest"] }));
    return decodeFunctionResult({ abi: ERC20, functionName, data: result });
  }

  /**
   * Sends a transaction from this account on the deployment's chain and waits for it to be mined
   * successfully. The wallet is put on the chain again right before the send, and the transaction
   * names the chain, so a wallet that moved to another one meanwhile refuses it. A wallet that cannot
   * return receipts is refused before anything is sent, so the console never leaves a sent
   * transaction unconfirmed for want of the read.
   */
  private async send(to: string, data: Hex, action: string, progress: Progress): Promise<string> {
    try {
      await this.provider.request({ method: "eth_getTransactionReceipt", params: [NO_TRANSACTION] });
    } catch (error) {
      throw walletError(error, `read transaction receipts, so the console did not ask it to ${action}`);
    }
    await this.ensureChain();
    progress(`Confirm in your wallet: ${action}.`);
    let hash: string;
    try {
      hash = String(await this.provider.request({ method: "eth_sendTransaction", params: [{ from: this.address, to, data, chainId: hex(this.chain.chainId) }] }));
    } catch (error) {
      throw walletError(error, action);
    }
    progress(`Waiting for the transaction to ${action} to be mined.`);
    const unconfirmed = (why: string) => new Error(`The transaction to ${action} was sent (${hash}) but ${why}. Check it in your wallet before trying again.`);
    for (let poll = 0; poll < RECEIPT_POLLS; poll++) {
      let receipt: unknown;
      try {
        receipt = await this.provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
      } catch (error) {
        throw unconfirmed(`its receipt could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      // No receipt yet is null; a mined one carries its status.
      const status = typeof receipt === "object" && receipt !== null && "status" in receipt ? receipt.status : undefined;
      if (status !== undefined) {
        if (Number(status) !== 1) throw new Error(`The transaction to ${action} failed on chain (${hash}).`);
        return hash;
      }
      await this.deps.wait(RECEIPT_POLL_MS);
    }
    throw unconfirmed("is not confirmed yet");
  }
}

/** The typed data in viem's shape; the engine's types and messages are its plain JSON form. */
function viemTyped(typed: TypedRequest): Parameters<typeof serializeTypedData>[0] {
  // `TypedRequest` holds exactly the fields viem reads: domain, types, primaryType and message.
  return typed as unknown as Parameters<typeof serializeTypedData>[0];
}
