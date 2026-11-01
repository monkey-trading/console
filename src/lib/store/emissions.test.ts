/** Tests for the MONKEY emissions position, the vault-record read, and the claim action. */

import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

import type { EntitlementProof } from "../engine/emissions";
import { ACCOUNT } from "../engine/wallet-kit";
import { MONKEY_UNIT } from "../format";
import { checkEmissionsClaimed, claimEmissions, emissionsPosition } from "./emissions";
import { connected, VAULT } from "./live-kit";

const VAULT_ABI = parseAbi(["function claimEmissions(address account, uint256 entitled, bytes32[] siblings) returns (uint256)"]);

const proof = (entitled: bigint, seq = 40): EntitlementProof => ({
  seq, root: `0x${"11".repeat(32)}`, account: ACCOUNT, entitled: entitled.toString(), siblings: [],
});

describe("emissionsPosition", () => {
  it("names nothing claimable before the node holds a proof, whatever the vault record says", () => {
    expect(emissionsPosition(null, null)).toEqual({ accrued: 0n, claimed: null, posted: false, claimable: 0n });
    expect(emissionsPosition(null, { claimed: 5n, latestSeq: 40 })).toEqual({ accrued: 0n, claimed: 5n, posted: false, claimable: 0n });
  });

  it("counts nothing claimable until the vault's record is read and its checkpoint posts", () => {
    const at = proof(5n * MONKEY_UNIT);
    expect(emissionsPosition(at, null)).toEqual({ accrued: 5n * MONKEY_UNIT, claimed: null, posted: false, claimable: 0n });
    const early = emissionsPosition(at, { claimed: 0n, latestSeq: 39 });
    expect(early).toEqual({ accrued: 5n * MONKEY_UNIT, claimed: 0n, posted: false, claimable: 0n });
  });

  it("claims the accrued amount the vault has not minted, and nothing once it caught up or ran ahead", () => {
    const at = proof(5n * MONKEY_UNIT);
    expect(emissionsPosition(at, { claimed: 2n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(3n * MONKEY_UNIT);
    expect(emissionsPosition(at, { claimed: 5n * MONKEY_UNIT, latestSeq: 41 }).claimable).toBe(0n);
    expect(emissionsPosition(at, { claimed: 6n * MONKEY_UNIT, latestSeq: 41 }).claimable).toBe(0n);
  });
});

describe("checkEmissionsClaimed", () => {
  it("reads the vault's record through the wallet and keeps it for the connected wallet", async () => {
    const { store } = await connected({ emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toEqual({ claimed: 7n * MONKEY_UNIT, latestSeq: 40 });
  });

  it("refuses the read on another chain and reports it, leaving the record unread", async () => {
    const { store } = await connected({ chainId: 1, emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The vault's MONKEY record could not be read: your wallet is on chain 1, not chain 31337");
    // The effect asks again on the next refresh; the same failure is not shown twice.
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("MONKEY record could not be read"))).toHaveLength(1);
    // A wallet back on the chain reads cleanly and clears the latch.
    store.liveWallet = null;
    const home = await connected({ emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    home.store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(home.store);
    expect(home.store.getSnapshot().emissionsVault).toEqual({ claimed: 7n * MONKEY_UNIT, latestSeq: 40 });
  });
});

describe("claimEmissions", () => {
  it("sends the vault's claimEmissions for the gap the proof proves and settles the line after", async () => {
    const { provider, store } = await connected();
    const at = proof(5n * MONKEY_UNIT);
    store.patch({ entitlement: at, emissionsVault: { claimed: 2n * MONKEY_UNIT, latestSeq: 40 } });
    await claimEmissions(store);
    const tx = provider.sent.at(-1);
    expect(tx?.to).toBe(VAULT);
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: tx?.data ?? "0x" });
    expect(decoded.functionName).toBe("claimEmissions");
    expect(String(decoded.args[0]).toLowerCase()).toBe(ACCOUNT);
    expect(decoded.args.slice(1)).toEqual([5n * MONKEY_UNIT, []]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The vault minted 3 MONKEY to your wallet.");
    expect(store.getSnapshot().emissionsVault).toBeNull();
    expect(store.getSnapshot().busy).toBe(false);
  });

  it("refuses a claim without a wallet or with a proof for another account, and sends nothing", async () => {
    const bare = await connected();
    bare.store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: { claimed: 0n, latestSeq: 40 } });
    bare.store.liveWallet = null;
    await claimEmissions(bare.store);
    expect(bare.store.getSnapshot().toasts.at(-1)?.text).toBe("Connect a wallet first.");
    const other = await connected();
    other.store.patch({ entitlement: { ...proof(5n * MONKEY_UNIT), account: "0x00000000000000000000000000000000000000aa" }, emissionsVault: { claimed: 0n, latestSeq: 40 } });
    await claimEmissions(other.store);
    expect(other.store.getSnapshot().toasts.at(-1)?.text).toBe("The entitlement proof is for another account.");
    expect(other.provider.sent).toHaveLength(0);
  });

  it("sends nothing when the checkpoint has not posted or the vault record is unread", async () => {
    const { provider, store } = await connected();
    store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: { claimed: 0n, latestSeq: 39 } });
    await claimEmissions(store);
    store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: null });
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
  });
});
