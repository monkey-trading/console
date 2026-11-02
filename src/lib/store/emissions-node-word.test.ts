/** The MONKEY claim decides on the node's word that its proof is claimable (monkey-trading/console#252). */

import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

import type { EntitlementProof } from "../engine/emissions";
import { ACCOUNT } from "../engine/wallet-kit";
import { MONKEY_UNIT } from "../format";
import { claimEmissions, emissionsPosition, WAITING_ON_VAULT } from "./emissions";
import { connected } from "./live-kit";

const VAULT_ABI = parseAbi(["function claimEmissions(address account, uint256 entitled, uint64 checkpointSeq, bytes32[] siblings) returns (uint256)"]);

const proof = (entitled: bigint, seq = 40): EntitlementProof => ({
  seq, root: `0x${"11".repeat(32)}`, account: ACCOUNT, entitled: entitled.toString(), siblings: [],
});

describe("claimEmissions on the node's word", () => {
  const accepted = (entitled: bigint, seq = 40): EntitlementProof => ({ ...proof(entitled, seq), accepted_seq: seq, newest_seq: seq, claimable: true });

  it("sends when the node says claimable although the wallet's read of the vault's latest seq is behind", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 2n * MONKEY_UNIT, latestSeq: 39 });
    client.entitlement = accepted(5n * MONKEY_UNIT, 41);
    store.patch({ entitlement: client.entitlement });
    await claimEmissions(store);
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: provider.sent.at(-1)?.data ?? "0x" });
    expect(decoded.args.slice(1)).toEqual([5n * MONKEY_UNIT, 41n, []]);
    expect(store.getSnapshot().notices.emissions).toBeUndefined();
  });

  it("says the vault has not accepted the proof's checkpoint, with one read and no retries, when the node says not claimable", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 0n, latestSeq: 99 });
    client.entitlement = { ...proof(5n * MONKEY_UNIT, 40), accepted_seq: null, newest_seq: 40, claimable: false };
    let proofReads = 0;
    const original = client.emissions.bind(client);
    client.emissions = async () => { proofReads++; return original(); };
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
    expect(proofReads).toBe(1);
    expect(store.getSnapshot().notices.emissions).toMatchObject({ tone: "info", text: WAITING_ON_VAULT });
  });

  it("claims nothing twice: once the vault's minted figure has caught up with the proof, no transaction is sent", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 5n * MONKEY_UNIT, latestSeq: 39 });
    client.entitlement = accepted(5n * MONKEY_UNIT);
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
    expect(store.getSnapshot().notices.emissions).toBeUndefined();
  });

  it("shows a plain message in the panel when the vault reverts for a checkpoint it does not know", async () => {
    // The wallet reports the selector of UnknownCheckpoint() under JSON-RPC's revert code.
    const { client, provider, store } = await connected({ emissionsClaimed: 0n, latestSeq: 39, fail: { eth_sendTransaction: { code: 3, message: "execution reverted: custom error 0x8f21ef34" } } });
    client.entitlement = accepted(5n * MONKEY_UNIT);
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(1);
    expect(store.getSnapshot().notices.emissions).toMatchObject({ tone: "error", text: expect.stringContaining("has not recorded the checkpoint this proof was built against") });
    expect(store.getSnapshot().notices.emissions?.text).not.toContain("0x");
    expect(store.getSnapshot().busy).toBe(false);
  });
});

describe("emissionsPosition on the node's word", () => {
  const at = (seq: number) => ({ ...proof(5n * MONKEY_UNIT, seq), accepted_seq: seq, newest_seq: seq, claimable: true });

  it("keeps the claim offered as newer proofs arrive while the wallet's read stays at an older seq", () => {
    const vault = { claimed: 2n * MONKEY_UNIT, latestSeq: 40 };
    for (const seq of [40, 41, 45, 46]) expect(emissionsPosition(at(seq), vault)).toMatchObject({ checkpoint: "posted", claimable: 3n * MONKEY_UNIT });
  });

  it("waits on a not claimable answer whatever the vault's seq reads, and offers nothing before the vault's minted figure is read", () => {
    expect(emissionsPosition({ ...at(40), claimable: false }, { claimed: 0n, latestSeq: 99 })).toMatchObject({ checkpoint: "waiting", claimable: 0n });
    expect(emissionsPosition(at(40), null)).toMatchObject({ checkpoint: "posted", claimed: null, claimable: 0n });
  });
});
