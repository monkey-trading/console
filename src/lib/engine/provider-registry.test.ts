/** Tests for the vault's and the registry's reads over a wallet's provider, including what a lying RPC can answer. */

import { decodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { ProviderDeployment } from "./provider-registry";
import type { Eip1193Provider, WalletChain } from "./provider-wallet";

const VAULT = "0x00000000000000000000000000000000000000dd";
const REGISTRY = "0x00000000000000000000000000000000000000ee";
const STAKING = "0x00000000000000000000000000000000000000cc";
const A = "0x00000000000000000000000000000000000000A1";
const B = "0x00000000000000000000000000000000000000b2";
const KEY = "0x00000000000000000000000000000000000000f1";
const RELEASE = `0x${"AB".repeat(32)}` as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const CHAIN: WalletChain = { chainId: 31337, vault: VAULT, usdc: null, add: null, staking: STAKING, registry: REGISTRY };
const ABI = parseAbi([
  "struct Operator { address candidate; address adminKey; bytes32 release; uint64 since; }",
  "struct Election { uint64 epoch; address candidate; address adminKey; bytes32 release; uint64 effectiveAt; bool promoted; }",
  "struct Candidate { address adminKey; address enclave; uint256 bond; bytes32 release; uint64 registration; string apiHostname; string handoverEndpoint; }",
  "function currentRelease() view returns (bytes32)",
  "function checkpointSigner() view returns (address)",
  "function rotationEnabled() view returns (bool)",
  "function namedOperator() view returns (Operator)",
  "function operatorInEffect() view returns (Operator)",
  "function pendingElection() view returns (Election)",
  "function candidateOf(address candidate) view returns (Candidate)",
  "function candidateCount() view returns (uint256)",
  "function candidateList(uint256 index) view returns (address)",
  "function isEligible(address candidate) view returns (bool)",
  "function votes(address candidate) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function delegates(address account) view returns (address)",
]);

interface World {
  chainId?: number;
  rotation?: boolean;
  /** The next election's effective time, in seconds; 0 for none. */
  effectiveAt?: bigint;
  hostnames?: Record<string, string>;
  list?: readonly Hex[];
  count?: bigint;
  delegate?: Hex;
}

const candidateOf = (hostname: string) => ({ adminKey: KEY as Hex, enclave: KEY as Hex, bond: 1n, release: RELEASE, registration: 0n, apiHostname: hostname, handoverEndpoint: "x" });

/** A provider answering the contracts' reads from `world`, recording each call in order. */
function rig(world: World = {}, chain = CHAIN) {
  const order: string[] = [];
  const provider: Eip1193Provider = {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return `0x${(world.chainId ?? 31337).toString(16)}`;
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const call = (params as readonly unknown[])[0] as { to: string; data: Hex };
      const decoded = decodeFunctionData({ abi: ABI, data: call.data });
      order.push(decoded.functionName);
      switch (decoded.functionName) {
        case "currentRelease": return encodeFunctionResult({ abi: ABI, functionName: "currentRelease", result: RELEASE });
        case "checkpointSigner": return encodeFunctionResult({ abi: ABI, functionName: "checkpointSigner", result: A as Hex });
        case "rotationEnabled": return encodeFunctionResult({ abi: ABI, functionName: "rotationEnabled", result: world.rotation ?? true });
        case "namedOperator": return encodeFunctionResult({ abi: ABI, functionName: "namedOperator", result: { candidate: A as Hex, adminKey: KEY as Hex, release: RELEASE, since: 100n } });
        case "operatorInEffect": return encodeFunctionResult({ abi: ABI, functionName: "operatorInEffect", result: { candidate: A as Hex, adminKey: KEY as Hex, release: RELEASE, since: 100n } });
        case "delegates": return encodeFunctionResult({ abi: ABI, functionName: "delegates", result: world.delegate ?? (ZERO as Hex) });
        case "pendingElection": return encodeFunctionResult({ abi: ABI, functionName: "pendingElection", result: { epoch: 3n, candidate: (world.effectiveAt ? B : ZERO) as Hex, adminKey: KEY as Hex, release: RELEASE, effectiveAt: world.effectiveAt ?? 0n, promoted: false } });
        case "candidateOf": return encodeFunctionResult({ abi: ABI, functionName: "candidateOf", result: candidateOf(world.hostnames?.[String(decoded.args[0]).toLowerCase()] ?? "") });
        case "candidateCount": return encodeFunctionResult({ abi: ABI, functionName: "candidateCount", result: world.count ?? BigInt((world.list ?? []).length) });
        case "candidateList": return encodeFunctionResult({ abi: ABI, functionName: "candidateList", result: world.list?.[Number(decoded.args[0])] ?? (ZERO as Hex) });
        case "isEligible": return encodeFunctionResult({ abi: ABI, functionName: "isEligible", result: String(decoded.args[0]).toLowerCase() === A.toLowerCase() });
        case "votes": return encodeFunctionResult({ abi: ABI, functionName: "votes", result: 40n });
        case "totalStaked": return encodeFunctionResult({ abi: ABI, functionName: "totalStaked", result: 100n });
        default: throw new Error("unexpected call");
      }
    },
  };
  return { reads: new ProviderDeployment(chain, provider), order };
}

describe("ProviderDeployment.vault", () => {
  it("reads the current release and the signer, lowercase, naming the contract's own getters", async () => {
    const { reads, order } = rig();
    await expect(reads.vault()).resolves.toEqual({ release: RELEASE.toLowerCase(), signer: A.toLowerCase() });
    expect(order).toEqual(["currentRelease", "checkpointSigner"]);
  });

  it("refuses to read on another chain, whose vault at this address is not the deployment's", async () => {
    await expect(rig({ chainId: 1 }).reads.vault()).rejects.toThrow("on chain 1, not chain 31337");
  });

  it("fails rather than answer from a contract that returns nothing", async () => {
    const provider: Eip1193Provider = { request: async ({ method }) => (method === "eth_chainId" ? "0x7a69" : "0x") };
    await expect(new ProviderDeployment(CHAIN, provider).vault()).rejects.toThrow();
  });
});

describe("ProviderDeployment.operator", () => {
  it("answers null, reading nothing, from a build that names no registry", async () => {
    const { reads, order } = rig({}, { ...CHAIN, registry: null });
    await expect(reads.operator()).resolves.toBeNull();
    expect(order).toEqual([]);
  });

  it("reads the named operator, its hostname and no pending election in four calls", async () => {
    const { reads, order } = rig({ hostnames: { [A.toLowerCase()]: "a.example" } });
    await expect(reads.operator()).resolves.toEqual({ rotationEnabled: true, candidate: A.toLowerCase(), adminKey: KEY, sinceMs: 100_000, hostname: "a.example", pending: null });
    expect(order).toEqual(["rotationEnabled", "namedOperator", "candidateOf", "pendingElection"]);
  });

  it("names an operator that registered no hostname as having none", async () => {
    await expect(rig().reads.operator()).resolves.toMatchObject({ hostname: null });
  });

  it("reads a pending election with its effective time in milliseconds", async () => {
    await expect(rig({ effectiveAt: 5_000n }).reads.operator()).resolves.toMatchObject({ pending: { epoch: 3, candidate: B, adminKey: KEY, effectiveAtMs: 5_000_000, promoted: false } });
  });
});

describe("ProviderDeployment.delegateOf", () => {
  it("names the candidate the account's stake votes for, lowercase, and none for the zero address", async () => {
    await expect(rig({ delegate: "0x00000000000000000000000000000000000000ab" }).reads.delegateOf(KEY)).resolves.toBe("0x00000000000000000000000000000000000000ab");
    await expect(rig().reads.delegateOf(KEY)).resolves.toBeNull();
  });

  it("answers null, reading nothing, from a build that names no staking contract", async () => {
    const { reads, order } = rig({}, { ...CHAIN, staking: null });
    await expect(reads.delegateOf(KEY)).resolves.toBeNull();
    expect(order).toEqual([]);
  });
});

describe("ProviderDeployment.candidates", () => {
  it("reads each listed candidate's hostname, votes and eligibility, and the total", async () => {
    const { reads, order } = rig({ list: [A as Hex, B as Hex], hostnames: { [A.toLowerCase()]: "a.example", [B]: "b.example" } });
    await expect(reads.candidates()).resolves.toEqual({
      totalStaked: 100n,
      inEffect: { candidate: A.toLowerCase(), hostname: "a.example" },
      candidates: [{ address: A.toLowerCase(), hostname: "a.example", votes: 40n, eligible: true }, { address: B, hostname: "b.example", votes: 40n, eligible: false }],
    });
    expect(order).toEqual(["candidateCount", "totalStaked", "operatorInEffect", "candidateOf", "candidateList", "candidateOf", "votes", "isEligible", "candidateList", "candidateOf", "votes", "isEligible"]);
  });

  it("answers null from a build that names no registry or no staking contract", async () => {
    await expect(rig({}, { ...CHAIN, registry: null }).reads.candidates()).resolves.toBeNull();
    await expect(rig({}, { ...CHAIN, staking: null }).reads.candidates()).resolves.toBeNull();
  });

  it("stops at once at a count the registry cannot hold, rather than read without bound", async () => {
    const { reads, order } = rig({ count: 101n });
    await expect(reads.candidates()).rejects.toThrow("more candidates than the registry can hold");
    expect(order).toEqual(["candidateCount"]);
    await expect(rig({ count: 2n ** 200n }).reads.candidates()).rejects.toThrow("more candidates");
  });

  it("skips a zero address in the list", async () => {
    const { reads } = rig({ count: 1n });
    await expect(reads.candidates()).resolves.toEqual({ totalStaked: 100n, inEffect: { candidate: A.toLowerCase(), hostname: null }, candidates: [] });
  });

  it("keeps a hostile hostname as data; nothing here decides a connection", async () => {
    const hostile = `https://evil.example/"><script>`;
    const { reads } = rig({ list: [B as Hex], hostnames: { [B]: hostile } });
    expect((await reads.candidates())?.candidates[0]?.hostname).toBe(hostile);
  });
});
