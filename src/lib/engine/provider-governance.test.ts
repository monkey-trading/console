import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, getAddress, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { walletError } from "./provider-errors";
import { ProviderGovernance } from "./provider-governance";
import type { Eip1193Provider } from "./provider-wallet";

const VOTE = "0x00000000000000000000000000000000000000a1";
const SCHEDULE = "0x00000000000000000000000000000000000000b2";
/** Checksummed, as a node or chain may give it; the reads compare it lowercase. */
const A = getAddress("0x00000000000000000000000000000000000000aa");
const B = "0x00000000000000000000000000000000000000bb";
const ABI = parseAbi([
  "struct Proposal { bytes32 commandHash; address proposer; uint32 setId; bool fast; bool passed; uint64 opensAt; uint64 closesAt; uint256 totalWeight; uint256 yesWeight; }",
  "function schedule() view returns (address)",
  "function proposalOf(uint256 id) view returns (Proposal, bytes)",
  "function voted(uint256 id, address member) view returns (bool)",
  "function vote(uint256 id)",
  "function setOf(uint32 setId) view returns (uint64 epoch, uint64 effectiveAt, address[] candidates, uint256[] weights)",
  "error AlreadyVoted(uint256 id, address member)",
]);
const PROPOSAL = [{ type: "tuple", components: [
  { name: "commandHash", type: "bytes32" }, { name: "proposer", type: "address" }, { name: "setId", type: "uint32" }, { name: "fast", type: "bool" }, { name: "passed", type: "bool" },
  { name: "opensAt", type: "uint64" }, { name: "closesAt", type: "uint64" }, { name: "totalWeight", type: "uint256" }, { name: "yesWeight", type: "uint256" },
] }, { type: "bytes" }] as const;

/** A provider that answers the vote contract's and the schedule's reads on chain `chainId`, recording each call as `name@to`. */
function rig(chainId = 31337) {
  const calls: string[] = [];
  const provider: Eip1193Provider = {
    async request({ method, params = [] }) {
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const call = (params as { to: string; data: Hex }[])[0];
      if (call === undefined) throw new Error("no call");
      const { functionName, args } = decodeFunctionData({ abi: ABI, data: call.data });
      calls.push(`${functionName}@${call.to}`);
      switch (functionName) {
        case "schedule": return encodeAbiParameters([{ type: "address" }], [SCHEDULE]);
        case "proposalOf": {
          const proposer = args[0] === 3n ? A : "0x0000000000000000000000000000000000000000";
          return encodeAbiParameters(PROPOSAL, [{ commandHash: `0x${"ab".repeat(32)}`, proposer, setId: 2, fast: true, passed: true, opensAt: 100n, closesAt: 3_700n, totalWeight: 900n, yesWeight: 700n }, "0x7b7d"]);
        }
        case "voted": return encodeAbiParameters([{ type: "bool" }], [args[0] === 3n && String(args[1]).toLowerCase() === A.toLowerCase()]);
        case "setOf": return encodeAbiParameters([{ type: "uint64" }, { type: "uint64" }, { type: "address[]" }, { type: "uint256[]" }], [4n, 5n, [A, B, A], [100n, 200n, 50n]]);
        default: throw new Error(`unexpected ${functionName}`);
      }
    },
  };
  const sent: { to: string; data: Hex; action: string }[] = [];
  const governance = new ProviderGovernance(31337, provider, async (to, data, action) => {
    sent.push({ to, data, action });
    return "0xhash";
  });
  return { governance, calls, sent, provider };
}

describe("ProviderGovernance", () => {
  it("reads a proposal as the contract holds it, and none for an id it never gave", async () => {
    const { governance } = rig();
    await expect(governance.proposal(VOTE, 3)).resolves.toEqual({ setId: 2, fast: true, passed: true, closesAtMs: 3_700_000, yes: 700n, total: 900n });
    await expect(governance.proposal(VOTE, 4)).resolves.toBeNull();
  });

  it("reads a set's members from the vote contract's schedule, read once, each member once with all its weight", async () => {
    const { governance, calls } = rig();
    await expect(governance.set(VOTE, 2)).resolves.toEqual([{ candidate: A.toLowerCase(), weight: 150n }, { candidate: B, weight: 200n }]);
    await governance.set(VOTE, 2);
    expect(calls).toEqual([`schedule@${VOTE}`, `setOf@${SCHEDULE}`, `setOf@${SCHEDULE}`]);
  });

  it("reads whether a member voted", async () => {
    const { governance } = rig();
    await expect(governance.voted(VOTE, 3, A)).resolves.toBe(true);
    await expect(governance.voted(VOTE, 3, B)).resolves.toBe(false);
  });

  it("says whether the wallet is on the deployment's chain, which a caller checks around its reads", async () => {
    await expect(rig(1).governance.onChain()).rejects.toThrow("your wallet is on chain 1, not chain 31337");
    await expect(rig().governance.onChain()).resolves.toBeUndefined();
  });

  it("sends one vote transaction to the vote contract, naming the proposal", async () => {
    const { governance, sent } = rig();
    await expect(governance.vote(VOTE, 7)).resolves.toBe("0xhash");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(VOTE);
    expect(sent[0]?.action).toBe("vote yes on proposal 7");
    expect(decodeFunctionData({ abi: ABI, data: sent[0]?.data ?? "0x" })).toEqual({ functionName: "vote", args: [7n] });
  });

  it("says in plain words why the vote contract refused a vote", async () => {
    const data = encodeErrorResult({ abi: ABI, errorName: "AlreadyVoted", args: [7n, A] });
    const governance = new ProviderGovernance(31337, rig().provider, async () => {
      throw walletError(Object.assign(new Error("execution reverted"), { code: 3, data }), "vote yes on proposal 7");
    });
    await expect(governance.vote(VOTE, 7)).rejects.toThrow("The vote contract already holds this account's vote on this proposal, so nothing was sent.");
  });
});
