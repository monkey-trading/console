/** Tests for the MONKEY emissions position, the vault-record read, and the claim action. */

import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

import type { AttestationStatus } from "../engine/attestation";
import { carryAccrued } from "../engine/claim-standing";
import type { EntitlementProof } from "../engine/emissions";
import { ACCOUNT } from "../engine/wallet-kit";
import type { Wallet } from "../engine/wallet";
import { MONKEY_UNIT } from "../format";
import { checkEmissionsClaimed, claimEmissions, emissionsPosition } from "./emissions";
import { connected, VAULT } from "./live-kit";

const VAULT_ABI = parseAbi(["function claimEmissions(address account, uint256 entitled, uint64 checkpointSeq, bytes32[] siblings) returns (uint256)"]);

const proof = (entitled: bigint, seq = 40): EntitlementProof => ({
  seq, root: `0x${"11".repeat(32)}`, account: ACCOUNT, entitled: entitled.toString(), siblings: [],
});

describe("emissionsPosition", () => {
  it("names nothing claimable before the node holds a proof, whatever the vault record says", () => {
    expect(emissionsPosition(null, null)).toEqual({ accrued: 0n, awaiting: 0n, claimed: null, checkpoint: "unknown", claimable: 0n });
    expect(emissionsPosition(null, { claimed: 5n, latestSeq: 40 })).toEqual({ accrued: 0n, awaiting: 0n, claimed: 5n, checkpoint: "unknown", claimable: 0n });
  });

  it("reports the checkpoint waiting until the vault posts one at the proof's seq", () => {
    const at = proof(5n * MONKEY_UNIT);
    expect(emissionsPosition(at, null).checkpoint).toBe("unknown");
    expect(emissionsPosition(at, { claimed: 0n, latestSeq: 39 })).toEqual({ accrued: 5n * MONKEY_UNIT, awaiting: 0n, claimed: 0n, checkpoint: "waiting", claimable: 0n });
    expect(emissionsPosition(at, { claimed: 2n * MONKEY_UNIT, latestSeq: 40 }).checkpoint).toBe("posted");
  });

  it("treats a checkpoint at or past the proof's seq as claimable, since the vault keeps the root of each one", () => {
    const at = proof(5n * MONKEY_UNIT);
    expect(emissionsPosition(at, { claimed: 2n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(3n * MONKEY_UNIT);
    // A newer checkpoint has posted: the proof still claims.
    expect(emissionsPosition(at, { claimed: 0n, latestSeq: 41 })).toEqual({ accrued: 5n * MONKEY_UNIT, awaiting: 0n, claimed: 0n, checkpoint: "posted", claimable: 5n * MONKEY_UNIT });
    // The vault caught up: nothing is due.
    expect(emissionsPosition(at, { claimed: 5n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(0n);
    // The vault record cannot run ahead of what it minted.
    expect(emissionsPosition(at, { claimed: 6n * MONKEY_UNIT, latestSeq: 40 }).claimable).toBe(0n);
  });
});

describe("emissionsPosition against a node that says what is newest", () => {
  const lagging = { ...proof(5n * MONKEY_UNIT), accepted_seq: 40, newest_seq: 44, newest_entitled: (8n * MONKEY_UNIT).toString(), claimable: true };

  it("accrues what the newest checkpoint names, and claims only what the proof pays, while the vault lags", () => {
    expect(emissionsPosition(lagging, { claimed: 2n * MONKEY_UNIT, latestSeq: 40 })).toEqual({
      accrued: 8n * MONKEY_UNIT, awaiting: 3n * MONKEY_UNIT, claimed: 2n * MONKEY_UNIT, checkpoint: "posted", claimable: 3n * MONKEY_UNIT,
    });
  });

  it("has nothing awaiting once the vault has caught up to the newest checkpoint", () => {
    const caughtUp = { ...proof(8n * MONKEY_UNIT, 44), accepted_seq: 44, newest_seq: 44, newest_entitled: (8n * MONKEY_UNIT).toString(), claimable: true };
    expect(emissionsPosition(caughtUp, { claimed: 5n * MONKEY_UNIT, latestSeq: 44 })).toEqual({
      accrued: 8n * MONKEY_UNIT, awaiting: 0n, claimed: 5n * MONKEY_UNIT, checkpoint: "posted", claimable: 3n * MONKEY_UNIT,
    });
  });

  it("keeps accrued where it was when an answer moves back to the older checkpoint the vault has reached", () => {
    const newest = { ...proof(8n * MONKEY_UNIT, 44), accepted_seq: null, newest_seq: 44, newest_entitled: (8n * MONKEY_UNIT).toString(), claimable: false };
    const back = carryAccrued(newest, lagging);
    expect(emissionsPosition(newest, { claimed: 0n, latestSeq: 40 }).accrued).toBe(8n * MONKEY_UNIT);
    expect(emissionsPosition(back, { claimed: 0n, latestSeq: 40 })).toMatchObject({ accrued: 8n * MONKEY_UNIT, checkpoint: "posted", claimable: 5n * MONKEY_UNIT });
  });

  it("reads a node without the fields as it always has", () => {
    expect(emissionsPosition(proof(5n * MONKEY_UNIT), { claimed: 2n * MONKEY_UNIT, latestSeq: 40 })).toMatchObject({ accrued: 5n * MONKEY_UNIT, awaiting: 0n, claimable: 3n * MONKEY_UNIT });
  });
});

describe("checkEmissionsClaimed", () => {
  it("reads the vault's record through the wallet and keeps it for the connected wallet", async () => {
    const { store } = await connected({ emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toEqual({ claimed: 7n * MONKEY_UNIT, latestSeq: 40 });
  });

  it("stays silent when the read is refused on another chain, and reads again once the wallet is back", async () => {
    const { provider, store } = await connected({ chainId: 1, emissionsClaimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    store.patch({ entitlement: proof(9n * MONKEY_UNIT) });
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toBeNull();
    expect(store.getSnapshot().notices).toEqual({});
    provider.chainId = 31337;
    await checkEmissionsClaimed(store);
    expect(store.getSnapshot().emissionsVault).toEqual({ claimed: 7n * MONKEY_UNIT, latestSeq: 40 });
    expect(store.getSnapshot().notices).toEqual({});
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
    expect(store.getSnapshot().notices).toEqual({});
  });
});

describe("claimEmissions", () => {
  it("sends the vault's claimEmissions for the gap the proof proves and settles the line after", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 2n * MONKEY_UNIT, latestSeq: 40 });
    const at = proof(5n * MONKEY_UNIT);
    client.entitlement = at;
    store.patch({ entitlement: at });
    await checkEmissionsClaimed(store); // reads the record
    await claimEmissions(store);
    const tx = provider.sent.at(-1);
    expect(tx?.to).toBe(VAULT);
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: tx?.data ?? "0x" });
    expect(decoded.functionName).toBe("claimEmissions");
    expect(String(decoded.args[0]).toLowerCase()).toBe(ACCOUNT);
    expect(decoded.args.slice(1)).toEqual([5n * MONKEY_UNIT, 40n, []]);
    expect(store.getSnapshot().notices.emissions).toBeUndefined();
    expect(store.getSnapshot().emissionsVault).toBeNull();
    expect(store.getSnapshot().busy).toBe(false);
  });

  it("re-reads the proof and claims with the newer one when the stored pair is stale", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 2n * MONKEY_UNIT, latestSeq: 40 });
    // The page holds a stale pair: the vault moved past the stored proof's seq. The node now
    // serves a proof against the vault's latest checkpoint, and the claim uses it.
    const stale = proof(5n * MONKEY_UNIT, 40);
    const fresh = proof(8n * MONKEY_UNIT, 41);
    client.entitlement = fresh;
    store.patch({ entitlement: stale, emissionsVault: { claimed: 2n * MONKEY_UNIT, latestSeq: 41 } });
    provider.vault.latestSeq = 41;
    await claimEmissions(store);
    const tx = provider.sent.at(-1);
    expect(tx?.to).toBe(VAULT);
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: tx?.data ?? "0x" });
    expect(decoded.functionName).toBe("claimEmissions");
    // The fresh proof's cumulative entitlement, less the fresh record's claimed: 8 - 2.
    expect(decoded.args.slice(1)).toEqual([8n * MONKEY_UNIT, 41n, []]);
    expect(store.getSnapshot().notices.emissions).toBeUndefined();
  });

  it("claims at the proof's own seq while the vault's latest has moved past it", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 2n * MONKEY_UNIT, latestSeq: 44 });
    client.entitlement = proof(5n * MONKEY_UNIT, 40);
    store.patch({ entitlement: client.entitlement });
    await claimEmissions(store);
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: provider.sent.at(-1)?.data ?? "0x" });
    expect(decoded.args.slice(1)).toEqual([5n * MONKEY_UNIT, 40n, []]);
    expect(store.getSnapshot().notices.emissions).toBeUndefined();
  });

  it("keeps the waiting state after a bounded number of attempts while the vault has not reached the proof", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 0n, latestSeq: 39 });
    const at = proof(5n * MONKEY_UNIT, 40);
    client.entitlement = at;
    store.patch({ entitlement: at });
    let proofReads = 0;
    const original = client.emissions.bind(client);
    client.emissions = async () => { proofReads++; return original(); };
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
    expect(proofReads).toBe(3); // bounded: the claim does not spin on a vault that stays behind
    expect(store.getSnapshot().notices.emissions).toMatchObject({ tone: "info", text: "The vault has not reached the checkpoint of the node's latest proof yet; the claim unlocks once it does." });
    // A node that now holds no proof at all says so instead of blaming the lag.
    client.emissions = original;
    client.entitlement = null;
    await claimEmissions(store);
    expect(store.getSnapshot().notices.emissions).toMatchObject({ tone: "info", text: "The node holds no entitlement proof for this account right now." });
  });

  it("refuses a claim without a wallet or with a proof for another account, and sends nothing", async () => {
    const bare = await connected();
    bare.client.entitlement = proof(5n * MONKEY_UNIT);
    bare.store.patch({ entitlement: proof(5n * MONKEY_UNIT), emissionsVault: { claimed: 0n, latestSeq: 40 } });
    bare.store.liveWallet = null;
    await claimEmissions(bare.store);
    expect(bare.store.getSnapshot().notices.emissions).toMatchObject({ tone: "error", text: "Connect a wallet first." });
    const other = await connected();
    other.client.entitlement = { ...proof(5n * MONKEY_UNIT), account: "0x00000000000000000000000000000000000000aa" };
    other.provider.vault.latestSeq = 40;
    await claimEmissions(other.store);
    expect(other.store.getSnapshot().notices.emissions).toMatchObject({ tone: "error", text: "The entitlement proof is for another account." });
    expect(other.provider.sent).toHaveLength(0);
  });

  it("sends nothing while the vault is behind the proof, and reports nothing due once it has reached it", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 5n * MONKEY_UNIT, latestSeq: 40 });
    // The vault is behind the proof: waiting.
    client.entitlement = proof(5n * MONKEY_UNIT, 40);
    provider.vault.latestSeq = 39;
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
    expect(store.getSnapshot().notices.emissions?.text).toContain("has not reached");
    // The vault has reached the proof and already minted it all: nothing is due.
    provider.vault.latestSeq = 40;
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
    expect(store.getSnapshot().notices.emissions).toBeUndefined();
  });

  it("waits on a verdict that may sign, says why, and sends nothing: the transaction would be built from the node's proof", async () => {
    const refusals: [AttestationStatus, string][] = [
      [{ kind: "attested", release: "r", address: ACCOUNT, why: "Your wallet did not answer." }, "the vault's current release has not been checked"],
      [{ kind: "clock", skewMs: 60_000 }, "your device clock differs from the node's signed time"],
      [{ kind: "unverified", reason: "no" }, "the node's attestation is not verified"],
      [{ kind: "reverifying" }, "the node is being verified again"],
    ];
    for (const [attestation, why] of refusals) {
      const { client, provider, store } = await connected({ emissionsClaimed: 0n, latestSeq: 40 });
      client.entitlement = proof(5n * MONKEY_UNIT);
      store.patch({ attestation });
      await claimEmissions(store);
      expect(provider.sent).toHaveLength(0);
      expect(store.getSnapshot().notices.emissions?.text).toBe(`The console will not claim MONKEY: ${why}.`);
      expect(store.getSnapshot()).toMatchObject({ busy: false, prompt: null });
    }
  });

  it("sends nothing when the verdict ends while the reads wait on the wallet", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 0n, latestSeq: 40 });
    client.emissions = async () => {
      store.patch({ attestation: { kind: "attested", release: "r", address: ACCOUNT, why: "Your wallet did not answer." } });
      return proof(5n * MONKEY_UNIT);
    };
    await claimEmissions(store);
    expect(provider.sent).toHaveLength(0);
    expect(store.getSnapshot().notices.emissions?.text).toBe("The console will not claim MONKEY: the vault's current release has not been checked.");
  });

  it("stands down when the wallet changes while the fresh reads run", async () => {
    const { client, provider, store } = await connected({ emissionsClaimed: 0n, latestSeq: 40 });
    let release!: (proof: EntitlementProof | null) => void;
    client.emissions = () => new Promise<EntitlementProof | null>((resolve) => { release = resolve; });
    const claiming = claimEmissions(store);
    store.liveWallet = null; // disconnected while the node's answer was in flight
    release(proof(5n * MONKEY_UNIT, 40));
    await claiming;
    expect(provider.sent).toHaveLength(0);
  });
});
