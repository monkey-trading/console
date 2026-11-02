/**
 * The staking contract's and the vault's distribution transactions over an EIP-1193 provider, and
 * the chain reads that show an account's standing. `provider-wallet.ts` holds one per wallet.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import type { DistributionProof } from "./stats-types";
import { hexOf, type Eip1193Provider, type WalletChain } from "./provider-wallet";
import type { StakingPosition, StakingWallet } from "./staking";
import type { Progress } from "./wallet";

/** The vault that has not deployed its token yet names the zero address. */
const NO_TOKEN = "0x0000000000000000000000000000000000000000";

const ERC20 = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
// `Staking.sol`; `unstakes` is the public getter of its `Unstake { amount, claimableAt }` struct.
const STAKING = parseAbi([
  "function stake(uint256 amount)",
  "function startUnstake(uint256 amount)",
  "function completeUnstake()",
  "function stakes(address account) view returns (uint256)",
  "function unstakes(address account) view returns (uint256 amount, uint256 claimableAt)",
]);
const VAULT = parseAbi([
  "function claimDistribution(address account, uint256 entitled, bytes32[] siblings) returns (uint256)",
  "function distributionsClaimed(address account) view returns (uint256)",
  "function latestSeq() view returns (uint64)",
  "function monkey() view returns (address)",
]);

/** How the wallet sends a transaction and waits for it to mine, and puts itself on the deployment's chain. */
export interface StakingTransport {
  send(to: string, data: Hex, action: string, progress: Progress): Promise<string>;
  ensureChain(): Promise<void>;
}

export class ProviderStaking implements StakingWallet {
  /** The MONKEY token, read from the vault once it has one. */
  private token: Hex | null = null;

  constructor(
    private readonly address: string,
    private readonly chain: WalletChain,
    private readonly provider: Eip1193Provider,
    private readonly transport: StakingTransport,
  ) {}

  private staking(): string {
    if (this.chain.staking === undefined || this.chain.staking === null) throw new Error("This build names no staking contract, so it cannot stake.");
    return this.chain.staking;
  }

  private stakingAddress(): string | null {
    return this.chain.staking ?? null;
  }

  private async call(to: string, data: Hex): Promise<Hex> {
    return hexOf(await this.provider.request({ method: "eth_call", params: [{ to, data }, "latest"] }));
  }

  /** The vault's MONKEY token, or null while it names the zero address (no token deployed yet), which is read again next time. */
  private async tokenAddress(): Promise<Hex | null> {
    if (this.token === null) {
      const data = encodeFunctionData({ abi: VAULT, functionName: "monkey" });
      const token = decodeFunctionResult({ abi: VAULT, functionName: "monkey", data: await this.call(this.chain.vault, data) });
      if (token === NO_TOKEN) return null;
      this.token = token;
    }
    return this.token;
  }

  /**
   * Reads one value after another, so a wallet over WalletConnect is asked once at a time; refused
   * on another chain. The vault's record (what it has paid and its checkpoint) needs only the
   * vault, so a build that names no staking contract still reads it.
   */
  async position(): Promise<StakingPosition> {
    const current = Number(await this.provider.request({ method: "eth_chainId" }));
    if (current !== this.chain.chainId) throw new Error(`your wallet is on chain ${current}, not chain ${this.chain.chainId}`);
    const owner = hexOf(this.address);
    const paid = decodeFunctionResult({ abi: VAULT, functionName: "distributionsClaimed", data: await this.call(this.chain.vault, encodeFunctionData({ abi: VAULT, functionName: "distributionsClaimed", args: [owner] })) });
    const latestSeq = decodeFunctionResult({ abi: VAULT, functionName: "latestSeq", data: await this.call(this.chain.vault, encodeFunctionData({ abi: VAULT, functionName: "latestSeq" })) });
    const staking = this.stakingAddress();
    let staked = 0n;
    let unstaking: StakingPosition["unstaking"] = null;
    if (staking !== null) {
      staked = decodeFunctionResult({ abi: STAKING, functionName: "stakes", data: await this.call(staking, encodeFunctionData({ abi: STAKING, functionName: "stakes", args: [owner] })) });
      const [amount, claimableAt] = decodeFunctionResult({ abi: STAKING, functionName: "unstakes", data: await this.call(staking, encodeFunctionData({ abi: STAKING, functionName: "unstakes", args: [owner] })) });
      unstaking = amount > 0n ? { amount, claimableAtMs: Number(claimableAt) * 1000 } : null;
    }
    const token = await this.tokenAddress();
    const balance = token === null ? 0n : decodeFunctionResult({ abi: ERC20, functionName: "balanceOf", data: await this.call(token, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [owner] })) });
    return { stakingEnabled: staking !== null, staked, unstaking, balance, distributionsClaimed: paid, latestSeq: Number(latestSeq) };
  }

  async stake(amount: bigint, progress: Progress = () => undefined): Promise<string> {
    if (amount <= 0n) throw new Error("The amount must be more than zero.");
    const staking = this.staking();
    await this.transport.ensureChain();
    const owner = hexOf(this.address);
    const spender = hexOf(staking);
    const token = await this.tokenAddress();
    if (token === null) throw new Error("The vault has not deployed its MONKEY token yet.");
    const balance = decodeFunctionResult({ abi: ERC20, functionName: "balanceOf", data: await this.call(token, encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [owner] })) });
    if (balance < amount) throw new Error("Your wallet holds less MONKEY than that.");
    const allowance = decodeFunctionResult({ abi: ERC20, functionName: "allowance", data: await this.call(token, encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [owner, spender] })) });
    if (allowance < amount) await this.transport.send(token, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, amount] }), "approve the staking contract", progress);
    return this.transport.send(staking, encodeFunctionData({ abi: STAKING, functionName: "stake", args: [amount] }), "stake MONKEY", progress);
  }

  async startUnstake(amount: bigint, progress: Progress = () => undefined): Promise<string> {
    if (amount <= 0n) throw new Error("The amount must be more than zero.");
    return this.transport.send(this.staking(), encodeFunctionData({ abi: STAKING, functionName: "startUnstake", args: [amount] }), "start the unstake", progress);
  }

  async completeUnstake(progress: Progress = () => undefined): Promise<string> {
    return this.transport.send(this.staking(), encodeFunctionData({ abi: STAKING, functionName: "completeUnstake" }), "complete the unstake", progress);
  }

  /** The proof names this account: the node signed it for the account's own route. */
  async claimDistribution(proof: DistributionProof, progress: Progress = () => undefined): Promise<string> {
    if (proof.account.toLowerCase() !== this.address.toLowerCase()) throw new Error("The distribution proof is for another account.");
    // `BigInt` throws on a malformed string; the enclave signed this shape for the account's route.
    const entitled = BigInt(proof.entitled);
    if (entitled <= 0n) throw new Error("The distribution proof names nothing to claim.");
    const data = encodeFunctionData({ abi: VAULT, functionName: "claimDistribution", args: [hexOf(this.address), entitled, proof.siblings.map(hexOf)] });
    return this.transport.send(this.chain.vault, data, "claim your USDC distribution", progress);
  }
}
