/** The vote contract's reads and its vote over an EIP-1193 provider; `provider-wallet.ts` holds one per wallet. */

import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import { voteFailure } from "./claim-refusal";
import type { ChainProposal, GovernanceWallet, SetMember } from "./governance-wallet";
import { hexOf, type Eip1193Provider } from "./provider-wallet";
import { WALLET_READ_MS, withinMs } from "./serialized-provider";
import type { Progress } from "./wallet";

// `ParameterVote.sol` and `OperatorSchedule.setOf` (monkey-trading/engine#585).
const VOTE = parseAbi([
  "struct Proposal { bytes32 commandHash; address proposer; uint32 setId; bool fast; bool passed; uint64 opensAt; uint64 closesAt; uint256 totalWeight; uint256 yesWeight; }",
  "function schedule() view returns (address)",
  "function proposalOf(uint256 id) view returns (Proposal, bytes)",
  "function voted(uint256 id, address member) view returns (bool)",
  "function vote(uint256 id)",
]);
const SCHEDULE = parseAbi(["function setOf(uint32 setId) view returns (uint64 epoch, uint64 effectiveAt, address[] candidates, uint256[] weights)"]);
const NO_PROPOSER = "0x0000000000000000000000000000000000000000";

/** How the wallet sends a transaction and waits for it to mine. */
export type GovernanceSend = (to: string, data: Hex, action: string, progress: Progress) => Promise<string>;

/** The vote contract's reads and vote through one wallet's provider. */
export class ProviderGovernance implements GovernanceWallet {
  /** Each vote contract's schedule, which never changes. */
  private readonly schedules = new Map<string, Hex>();

  constructor(
    private readonly chainId: number,
    private readonly provider: Eip1193Provider,
    private readonly send: GovernanceSend,
  ) {}

  /** Refused while the wallet is on another chain, where the contract's address names something else. */
  async onChain(): Promise<void> {
    const current = Number(await withinMs(this.provider, { method: "eth_chainId" }, WALLET_READ_MS));
    if (current !== this.chainId) throw new Error(`your wallet is on chain ${current}, not chain ${this.chainId}`);
  }

  private async call(to: string, data: Hex): Promise<Hex> {
    return hexOf(await withinMs(this.provider, { method: "eth_call", params: [{ to, data }, "latest"] }, WALLET_READ_MS));
  }

  async proposal(vote: string, id: number): Promise<ChainProposal | null> {
    const data = encodeFunctionData({ abi: VOTE, functionName: "proposalOf", args: [BigInt(id)] });
    const [proposal] = decodeFunctionResult({ abi: VOTE, functionName: "proposalOf", data: await this.call(vote, data) });
    // An id the contract never gave holds zeros.
    if (proposal.proposer === NO_PROPOSER) return null;
    return { setId: proposal.setId, fast: proposal.fast, passed: proposal.passed, closesAtMs: Number(proposal.closesAt) * 1000, yes: proposal.yesWeight, total: proposal.totalWeight };
  }

  async set(vote: string, setId: number): Promise<SetMember[]> {
    let schedule = this.schedules.get(vote);
    if (schedule === undefined) {
      schedule = decodeFunctionResult({ abi: VOTE, functionName: "schedule", data: await this.call(vote, encodeFunctionData({ abi: VOTE, functionName: "schedule" })) });
      this.schedules.set(vote, schedule);
    }
    const [, , candidates, weights] = decodeFunctionResult({ abi: SCHEDULE, functionName: "setOf", data: await this.call(schedule, encodeFunctionData({ abi: SCHEDULE, functionName: "setOf", args: [setId] })) });
    // `ParameterVote.weightOf` adds every entry a candidate has, so the members are summed the same way.
    const members = new Map<string, bigint>();
    candidates.forEach((candidate, i) => {
      const key = candidate.toLowerCase();
      members.set(key, (members.get(key) ?? 0n) + (weights[i] ?? 0n));
    });
    return [...members].map(([candidate, weight]) => ({ candidate, weight }));
  }

  async voted(vote: string, id: number, member: string): Promise<boolean> {
    const data = encodeFunctionData({ abi: VOTE, functionName: "voted", args: [BigInt(id), hexOf(member)] });
    return decodeFunctionResult({ abi: VOTE, functionName: "voted", data: await this.call(vote, data) });
  }

  async vote(vote: string, id: number, progress: Progress = () => undefined): Promise<string> {
    const data = encodeFunctionData({ abi: VOTE, functionName: "vote", args: [BigInt(id)] });
    return this.send(vote, data, `vote yes on proposal ${id}`, progress).catch((error: unknown) => {
      throw voteFailure(error);
    });
  }
}
