/** Tests for the MONKEY emissions position, the vault-record read, and the claim action. */

import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

import type { EntitlementProof } from "../engine/emissions";
import { ACCOUNT } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { MONKEY_UNIT } from "../format";
import { checkEmissionsClaimed, claimEmissions, emissionsPosition, emissionsRecordStale } from "./emissions";
import { connected, VAULT } from "./live-kit";

const VAULT_ABI = parseAbi(["function claimEmissions(address account, uint256 entitled, bytes32[] siblings) returns (uint256)"]);

const proof = (entitled: bigint, seq = 40): EntitlementProof => ({
  seq, root: `0x${"11".repeat(32)}`, account: ACCOUNT, entitled: entitled.toString(), siblings: [],
});

describe("emissionsPosition", () => {
  it("names nothing claimable before the node holds a proof, whatever the vault record says", () => {
    expect(emissionsPosition(null, null)).toEqual({ accrued: 0n, claimed: null, checkpoint: "unknown", claimable: 0n });
    expect(emissionsPosition(null, { claimed: 5n, latestSeq: 40 })).toEqual({ accrued: 0n, claimed: 5n, checkpoint: "unknown", claimable: 0n });
  });

  it("reports the checkpoint waiting until the vault posts one at the proof's seq", () => {
    const at = proof(5n * MONKEY_UNIT);
    expect(emissionsPosition(at, null).checkpoint).toBe("unknown");
    expect(emissionsPosition(at, { claimed: 0n, latestSeq: 39 })).toEqual({ accrued: 5n * MONKEY_UNIT, claimed: 0n, checkpoint: "waiting", claimable: 0n });
    expect(emissionsPosition(at, { claimed: 2n * MONKEY_UNIT, latestSeq: 40 }).checkpoint).toBe("posted");
  });

  it("treats only a checkpoint exactly at the proof's seq as claimable, since the vault verifies against its latest root", () => {
    const at = proof(5n * MONKEY_UNIT);
    expect(emissionsPosition(at, { claimed: 2n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(3n * MONKEY_UNIT);
    // A newer checkpoint has superseded the proof: the claim would revert, so nothing is offered.
    expect(emissionsPosition(at, { claimed: 0n, latestSeq: 41 })).toEqual({ accrued: 5n * MONKEY_UNIT, claimed: 0n, checkpoint: "superseded", claimable: 0n });
    // The vault caught up: nothing is due.
    expect(emissionsPosition(at, { claimed: 5n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(0n);
    // The vault record cannot run ahead of what it minted.
    expect(emissionsPosition(at, { claimed: 6n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(0n);
  });
});

describe("emissionsRecordStale", () => {
  const at = proof(5n * MONKEY_UNIT);

  it("asks for an unread record at once, and a stale one only after the retry window", () => {
    expect(emissionsRecordStale(at, null, 0, -1)).toBe(true);
    expect(emissionsRecordStale(at, { latestSeq: 39 }, 0, -1)).toBe(true);
    expect(emissionsRecordStale(at, { latestSeq: 39 }, 30_000, 0)).toBe(false);
    expect(emissionsRecordStale(at, { latestSeq: 39 }, 60_000, 0)).toBe(true);
  });

  it("does not re-read a record that has reached the proof, whatever its age", () => {
    expect(emissionsRecordStale(at, { latestSeq: 40 }, 0, -1)).toBe(false);
    expect(emissionsRecordStale(at, { latestSeq: 41 }, 10_000_000, -1)).toBe(false);
  });
});

describe("checkEmissionsClaimed", () => {
  it("reads the vault's record through the wallet and keeps it for the connected wallet", async () => {
    const { store } = await connected({ emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toEqual({ claimed: 7n * MONKEY_UNIT, latestSeq: 40 });
  });

  it("refuses the read on another chain, reports it once, and clears the latch when that wallet reads cleanly", async () => {
    const { provider, store } = await connected({ chainId: 1, emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toBeNull();
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The vault's MONKEY record could not be read: your wallet is on chain 1, not chain 31337");
    // The effect asks again on the next refresh; the same failure is not shown twice.
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("MONKEY record could not be read"))).toHaveLength(1);
    // The same wallet back on the chain reads cleanly; the latch clears, so a later failure shows again.
    provider.chainId = 31337;
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toEqual({ claimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    provider.chainId = 1;
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("MONKEY record could not be read"))).toHaveLength(2);
  });

  it("resets the read latches when the wallet changes, so a new wallet's identical failure is reported", async () => {
    const { store } = await connected({ chainId: 1, emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store); // fails: warms the error latch and the retry window
    expect(store.lastEmissionsReadError).not.toBeNull();
    expect(store.lastEmissionsReadAt).toBe(0);
    const shown = () => store.getSnapshot().toasts.filter((t) => t.text.includes("MONKEY record could not be read")).length;
    expect(shown()).toBe(1);
    // The wallet changes: neither latch may carry over, and the identical failure toasts anew.
    store.setWallet({ address: "0x00000000000000000000000000000000000000bb", label: "Other" });
    expect(store.lastEmissionsReadError).toBeNull();
    expect(store.lastEmissionsReadAt).toBe(-1);
    await checkEmissionsClaimed(store);
    expect(shown()).toBe(2);
  });

  it("ignores a failure that lands after the wallet it ran for was replaced", async () => {
    const { store, wallet } = await connected();
    let fail!: (error: Error) => void;
    const pending = new Promise<{ claimed: bigint; latestSeq: number }>((_, reject) => { fail = reject; });
    const away: Wallet = {
      address: ACCOUNT, label: "Away",
      sign: async () => "0x", deposit: async () => "0x", claim: async () => "0x",
      emissionsClaimed: () => pending,
    };
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    store.liveWallet = away;
    const reading = checkEmissionsClaimed(store);
    store.liveWallet = wallet; // replaced before the read settles
    fail(new Error("your wallet is on chain 1, not chain 31337"));
    await reading;
    expect(store.getSnapshot().toasts.filter((t) => t.text.includes("MONKEY record could not be read"))).toHaveLength(0);
    expect(store.lastEmissionsReadAt).toBe(-1);
  });
});

describe("claimEmissions", () => {
  it("sends the vault's claimEmissions for the gap the proof proves and settles the line after", async () => {
    const { provider, store } = await connected({ emissionsClaimed: 2n * MONKEY_UNIT, latestSeq: 40 });
    const at = proof(5n * MONKEY_UNIT);
    store.patch({ entitlement: at });
    await checkEmissionsClaimed(store); // reads the record and warms the read window
    expect(store.lastEmissionsReadAt).toBe(0);
    await claimEmissions(store);
    const tx = provider.sent.at(-1);
    expect(tx?.to).toBe(VAULT);
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: tx?.data ?? "0x" });
    expect(decoded.functionName).toBe("claimEmissions");
    expect(String(decoded.args[0]).toLowerCase()).toBe(ACCOUNT);
    expect(decoded.args.slice(1)).toEqual([5n * MONKEY_UNIT, []]);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("The vault minted 3 MONKEY to your wallet.");
    expect(store.getSnapshot().emissionsVault).toBeNull();
    expect(store.lastEmissionsReadAt).toBe(-1); // the record's invalidation resets the read window
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

  it("sends nothing while the checkpoint is waiting or superseded, or the vault record is unread", async () => {
    const { provider, store } = await connected();
    store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: { claimed: 0n, latestSeq: 39 } });
    await claimEmissions(store);
    store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: { claimed: 0n, latestSeq: 41 } });
    await claimEmissions(store);
    store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: null });
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
  });
});
