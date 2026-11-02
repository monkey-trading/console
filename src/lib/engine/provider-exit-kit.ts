/** Tests only: a chain as a wallet reads it, each read answering what a test says. */

import { decodeFunctionData, encodeAbiParameters, toFunctionSelector, type Hex } from "viem";

import { EXIT_VAULT, EXIT_VERIFIER } from "./exit-abi";
import { rootAt } from "./exit-kit";

export const VERIFIER = "0x00000000000000000000000000000000000000ee";
export const STAKING = "0x00000000000000000000000000000000000000dd";
export const word = (type: "uint256" | "bool" | "address" | "bytes32", value: unknown): Hex => encodeAbiParameters([{ type }], [value as never]);

/** A chain as the wallet reads it: each read answers what a test says, and is recorded. */
export class Chain {
  chainId = 31337;
  blockTime = 2_000;
  /** False for a WalletConnect session, which refuses any method the console did not ask for. */
  readsBlocks = true;
  /** What each vault getter answers, by name. */
  vault: Record<string, Hex> = {
    exitStartedAt: word("uint256", 0n), hasCheckpoint: word("bool", true), latestSeq: word("uint256", 100n), latestRoot: rootAt(100) as Hex, lastCheckpointAt: word("uint256", 1_000n), exitPeriod: word("uint256", 2_592_000n), claimWindow: word("uint256", 2_592_000n),
    exitVerifier: word("address", VERIFIER), distributionsClaimed: word("uint256", 1_000_000n), exitAccountRegistered: word("bool", false), exitDistributionRegistered: word("bool", false), exitClaims: word("uint256", 7n), exitDistributionClaims: word("uint256", 2n),
    exitQueuedRegistered: word("bool", true), depositRefunded: word("bool", false), exitDepositCursor: word("uint256", 3n), depositCount: word("uint256", 3n),
  };
  /** What a vault getter answers at a finalized block, where it differs from the head. */
  finalVault: Record<string, Hex> = {};
  /** False for a wallet that cannot read a finalized block. */
  readsFinalized = true;
  paidNonces = new Set<bigint>();
  finalNonces = new Set<bigint>();
  deposits = new Map<bigint, { payer: Hex; amount: bigint }>();
  /** The verifier's answers; a name set to false refuses, and `reverts` rejects. */
  proves: Record<string, boolean> = {};
  reverts = new Set<string>();
  fails = new Set<string>();
  accountClaim = 5_010_000_000n;
  staked = 0n;
  unstaking = 0n;
  failing: string | null = null;
  asked: string[] = [];
  sentData: { to: string; data: Hex }[] = [];
  receipt: unknown = null;

  request = async ({ method, params = [] }: { method: string; params?: readonly unknown[] | { type: string; options: Record<string, unknown> } }): Promise<unknown> => {
    const list = Array.isArray(params) ? params : [];
    if (method === "eth_chainId") return `0x${this.chainId.toString(16)}`;
    if (method === "eth_getBlockByNumber") {
      if (!this.readsBlocks) throw new Error("The console does not send eth_getBlockByNumber over WalletConnect.");
      return { timestamp: `0x${this.blockTime.toString(16)}` };
    }
    if (method === "eth_getTransactionReceipt") return this.receipt;
    if (method !== "eth_call") throw new Error(`no ${method}`);
    const { to, data } = list[0] as { to?: string; data: Hex };
    if (to === undefined) return data === "0x4260005260206000f3" ? word("uint256", BigInt(this.blockTime)) : "0x";
    if (to.toLowerCase() === VERIFIER) return this.verifier(data);
    if (to.toLowerCase() === STAKING) return data.startsWith(toFunctionSelector("stakes(address)")) ? word("uint256", this.staked) : encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [this.unstaking, 9n]);
    const { functionName, args } = decodeFunctionData({ abi: EXIT_VAULT, data });
    this.asked.push(functionName);
    if (this.failing === functionName) throw new Error("the wallet's RPC failed");
    if (list[1] === "finalized" && !this.readsFinalized) throw new Error("this wallet does not read finalized blocks");
    if (functionName === "usedNonces") return word("bool", (list[1] === "finalized" ? this.finalNonces : this.paidNonces).has((args as readonly unknown[])[1] as bigint));
    if (functionName === "depositRecords") {
      const deposit = this.deposits.get((args as readonly unknown[])[0] as bigint);
      return encodeAbiParameters([{ type: "address" }, { type: "uint96" }], [deposit?.payer ?? "0x0000000000000000000000000000000000000000", deposit?.amount ?? 0n]);
    }
    const answer = (list[1] === "finalized" ? this.finalVault[functionName] : undefined) ?? this.vault[functionName];
    if (answer === undefined) throw new Error(`no answer for ${functionName}`);
    return answer;
  };

  private verifier(data: Hex): Hex {
    const { functionName } = decodeFunctionData({ abi: EXIT_VERIFIER, data });
    this.asked.push(functionName);
    if (this.reverts.has(functionName)) throw Object.assign(new Error("execution reverted"), { code: 3 });
    if (this.fails.has(functionName)) throw new Error("the provider is rate limiting this wallet");
    if (functionName === "accountClaim") return word("uint256", this.accountClaim);
    return word("bool", this.proves[functionName] ?? true);
  }
}
