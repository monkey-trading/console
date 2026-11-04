/** The vault's and the operator registry's reads over an EIP-1193 provider, one call at a time; see `registry.ts` for what they may be trusted with. */

import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";

import { hexOf, type Eip1193Provider, type WalletChain } from "./provider-wallet";
import { withinMs } from "./serialized-provider";
import type { DeploymentReads, NamedOperator, PendingElection, VaultFacts } from "./registry";

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
  "function pendingElection() view returns (Election)",
  "function candidateOf(address candidate) view returns (Candidate)",
]);

/** How long the wallet may take over one call or chain check, in milliseconds. */
const CALL_MS = 30_000;

/** Chain seconds as the milliseconds the console shows; beyond any time a chain could hold, so the conversion is exact. */
const secondsToMs = (seconds: bigint): number => Number(seconds) * 1000;

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
}
