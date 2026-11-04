/** Tests for the vault's and the registry's reads over a wallet's provider, including what a lying RPC can answer. */

import { decodeFunctionData, encodeFunctionResult, parseAbi, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

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
  "function pendingElection() view returns (Election)",
  "function candidateOf(address candidate) view returns (Candidate)",
]);

interface World {
  chainId?: number;
  rotation?: boolean;
  /** The next election's effective time, in seconds; 0 for none. */
  effectiveAt?: bigint;
  hostnames?: Record<string, string>;
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
        case "pendingElection": return encodeFunctionResult({ abi: ABI, functionName: "pendingElection", result: { epoch: 3n, candidate: (world.effectiveAt ? B : ZERO) as Hex, adminKey: KEY as Hex, release: RELEASE, effectiveAt: world.effectiveAt ?? 0n, promoted: false } });
        case "candidateOf": {
          const asked = String(decoded.args[0]).toLowerCase();
          return encodeFunctionResult({ abi: ABI, functionName: "candidateOf", result: candidateOf(world.hostnames?.[asked] ?? "") });
        }
        default: throw new Error("unexpected call");
      }
    },
  };
  return { reads: new ProviderDeployment(chain, provider), order, provider };
}

describe("a wallet that moves chain during a read", () => {
  it("gives no answer, rather than one read from two chains, on every read", async () => {
    const reads: [string, (deployment: ProviderDeployment) => Promise<unknown>][] = [
      ["vault", (deployment) => deployment.vault()],
      ["operator", (deployment) => deployment.operator()],
    ];
    for (const [name, read] of reads) {
      const { provider } = rig();
      let asked = 0;
      const moving: Eip1193Provider = { request: async (args) => (args.method === "eth_chainId" && ++asked > 1 ? "0x1" : provider.request(args)) };
      await expect(read(new ProviderDeployment(CHAIN, moving)), name).rejects.toThrow("on chain 1, not chain 31337");
    }
  });
});

describe("a chain check the wallet never answers", () => {
  it("fails every read at thirty seconds, as a call does, whether it is the check before the calls or the one after", async () => {
    vi.useFakeTimers();
    try {
      const reads: [string, (deployment: ProviderDeployment) => Promise<unknown>][] = [
        ["vault", (deployment) => deployment.vault()],
        ["operator", (deployment) => deployment.operator()],
      ];
      for (const [name, read] of reads) {
        for (const answered of [0, 1]) {
          const { provider } = rig();
          let asked = 0;
          const silent: Eip1193Provider = { request: (args) => (args.method === "eth_chainId" && asked++ >= answered ? new Promise(() => {}) : provider.request(args)) };
          let settled = false;
          const reading = read(new ProviderDeployment(CHAIN, silent)).finally(() => { settled = true; });
          const refused = expect(reading, name).rejects.toThrow("did not answer in time");
          await vi.advanceTimersByTimeAsync(29_999);
          expect(settled, `${name} before the limit`).toBe(false);
          await vi.advanceTimersByTimeAsync(1);
          await refused;
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

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
