/** The vault's and the operator registry's reads over an EIP-1193 provider, one call at a time; see `registry.ts` for what they may be trusted with. */

import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import { hexOf, type Eip1193Provider, type WalletChain } from "./provider-wallet";
import { withinMs } from "./serialized-provider";
import { CANDIDATE_LIMIT, NO_CANDIDATE, type CandidateTable, type DeploymentReads, type NamedOperator, type PendingElection, type Registration, type VaultFacts } from "./registry";
import type { Address } from "./types";

const VAULT = parseAbi([
  "function currentRelease() view returns (bytes32)",
  "function checkpointSigner() view returns (address)",
]);
const REGISTRY = parseAbi([
  "struct Operator { address candidate; address adminKey; bytes32 release; uint64 since; }",
  "struct Election { uint64 epoch; address candidate; address adminKey; bytes32 release; uint64 effectiveAt; bool promoted; }",
  "struct Candidate { address adminKey; address enclave; uint256 bond; bytes32 release; uint64 registration; string apiHostname; string handoverEndpoint; }",
  "function rotationEnabled() view returns (bool)",
  "function namedOperator() view returns (Operator)",
  "function operatorInEffect() view returns (Operator)",
  "function pendingElection() view returns (Election)",
  "function candidateOf(address candidate) view returns (Candidate)",
  "function candidateCount() view returns (uint256)",
  "function candidateList(uint256 index) view returns (address)",
  "function isEligible(address candidate) view returns (bool)",
]);
const STAKING = parseAbi([
  "function votes(address candidate) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function delegates(address account) view returns (address)",
]);

/** How long the wallet may take over one call or chain check, in milliseconds: a table of many candidates takes as long as it takes, one call after another. */
const CALL_MS = 30_000;

/** Chain seconds as the milliseconds the console shows; beyond any time a chain could hold, so the conversion is exact. */
const secondsToMs = (seconds: bigint): number => Number(seconds) * 1000;

/** What the table shows of a decoded `candidateOf`: the registration count is a `uint64` of registrations made, far below 2^53. */
const registrationOf = (registered: { bond: bigint; release: Hex; registration: bigint; handoverEndpoint: string }): Registration => ({
  bond: registered.bond, release: registered.release.toLowerCase(), registration: Number(registered.registration), handoverEndpoint: registered.handoverEndpoint,
});

export class ProviderDeployment implements DeploymentReads {
  constructor(private readonly chain: WalletChain, private readonly provider: Eip1193Provider) {}

  /** A background read: the wallet is not asked to switch chains, and the read is refused on another one. */
  private async onChain(): Promise<void> {
    const current = Number(await withinMs(this.provider, { method: "eth_chainId" }, CALL_MS));
    if (current !== this.chain.chainId) throw new Error(`your wallet is on chain ${current}, not chain ${this.chain.chainId}`);
  }

  private async call(to: string, data: Hex): Promise<Hex> {
    return hexOf(await withinMs(this.provider, { method: "eth_call", params: [{ to, data }, "latest"] }, CALL_MS));
  }

  /** `read`, whose calls all come from the deployment's chain: a wallet that moved while they ran gives no answer, rather than one from two chains. */
  private async onChainThroughout<T>(read: () => Promise<T>): Promise<T> {
    await this.onChain();
    const answer = await read();
    await this.onChain();
    return answer;
  }

  vault(): Promise<VaultFacts> {
    return this.onChainThroughout(async () => {
      const release = decodeFunctionResult({ abi: VAULT, functionName: "currentRelease", data: await this.call(this.chain.vault, encodeFunctionData({ abi: VAULT, functionName: "currentRelease" })) });
      const signer = decodeFunctionResult({ abi: VAULT, functionName: "checkpointSigner", data: await this.call(this.chain.vault, encodeFunctionData({ abi: VAULT, functionName: "checkpointSigner" })) });
      return { release: release.toLowerCase(), signer: signer.toLowerCase() };
    });
  }

  private async candidateOf(registry: string, candidate: Hex) {
    return decodeFunctionResult({ abi: REGISTRY, functionName: "candidateOf", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "candidateOf", args: [candidate] })) });
  }

  async operator(): Promise<NamedOperator | null> {
    const registry = this.chain.registry ?? null;
    return registry === null ? null : this.onChainThroughout(() => this.readOperator(registry));
  }

  private async readOperator(registry: string): Promise<NamedOperator> {
    const rotationEnabled = decodeFunctionResult({ abi: REGISTRY, functionName: "rotationEnabled", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "rotationEnabled" })) });
    const named = decodeFunctionResult({ abi: REGISTRY, functionName: "namedOperator", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "namedOperator" })) });
    const { apiHostname } = await this.candidateOf(registry, named.candidate);
    const election = decodeFunctionResult({ abi: REGISTRY, functionName: "pendingElection", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "pendingElection" })) });
    const pending: PendingElection | null = election.effectiveAt === 0n ? null : {
      epoch: Number(election.epoch), candidate: election.candidate.toLowerCase(), adminKey: election.adminKey.toLowerCase(), effectiveAtMs: secondsToMs(election.effectiveAt), promoted: election.promoted,
    };
    return { rotationEnabled, candidate: named.candidate.toLowerCase(), adminKey: named.adminKey.toLowerCase(), sinceMs: secondsToMs(named.since), hostname: apiHostname === "" ? null : apiHostname, pending };
  }

  /**
   * Error cases:
   * - the wallet is on another chain, or a read fails
   * - the answer names more candidates than the registry can hold, which only a lying RPC does
   */
  async candidates(): Promise<CandidateTable | null> {
    const registry = this.chain.registry ?? null;
    const staking = this.chain.staking ?? null;
    return registry === null || staking === null ? null : this.onChainThroughout(() => this.readCandidates(registry, staking));
  }

  private async readCandidates(registry: string, staking: string): Promise<CandidateTable> {
    const count = decodeFunctionResult({ abi: REGISTRY, functionName: "candidateCount", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "candidateCount" })) });
    if (count > BigInt(CANDIDATE_LIMIT)) throw new Error("The chain read named more candidates than the registry can hold.");
    const totalStaked = decodeFunctionResult({ abi: STAKING, functionName: "totalStaked", data: await this.call(staking, encodeFunctionData({ abi: STAKING, functionName: "totalStaked" })) });
    const inEffect = decodeFunctionResult({ abi: REGISTRY, functionName: "operatorInEffect", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "operatorInEffect" })) });
    const current = await this.candidateOf(registry, inEffect.candidate);
    const candidates = [];
    for (let index = 0n; index < count; index += 1n) {
      const address = decodeFunctionResult({ abi: REGISTRY, functionName: "candidateList", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "candidateList", args: [index] })) });
      if (address === NO_CANDIDATE) continue;
      const registered = await this.candidateOf(registry, address);
      const votes = decodeFunctionResult({ abi: STAKING, functionName: "votes", data: await this.call(staking, encodeFunctionData({ abi: STAKING, functionName: "votes", args: [address] })) });
      const eligible = decodeFunctionResult({ abi: REGISTRY, functionName: "isEligible", data: await this.call(registry, encodeFunctionData({ abi: REGISTRY, functionName: "isEligible", args: [address] })) });
      candidates.push({ address: address.toLowerCase(), hostname: registered.apiHostname, votes, eligible, ...registrationOf(registered) });
    }
    return {
      inEffect: {
        candidate: inEffect.candidate.toLowerCase(), hostname: current.apiHostname === "" ? null : current.apiHostname, release: inEffect.release.toLowerCase(),
        // An unregistered address answers the zero struct, whose admin key is zero: a registration always names one.
        registered: current.adminKey === NO_CANDIDATE ? null : registrationOf(current),
      },
      candidates,
      totalStaked,
    };
  }

  async delegateOf(account: Address): Promise<Address | null> {
    const staking = this.chain.staking ?? null;
    if (staking === null) return null;
    return this.onChainThroughout(async () => {
      const chosen = decodeFunctionResult({ abi: STAKING, functionName: "delegates", data: await this.call(staking, encodeFunctionData({ abi: STAKING, functionName: "delegates", args: [hexOf(account)] })) });
      return chosen === NO_CANDIDATE ? null : chosen.toLowerCase();
    });
  }
}
