import { beforeEach, describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { emptyProof, factsAt, fullProof, SCOPE } from "../engine/exit-kit";
import { exitStorageKey, writeStoredExit } from "../engine/exit-file";
import { parseExitProof } from "../engine/exit-proof";
import { settle } from "../engine/test-kit";
import { UntrustedError } from "../engine/trust";
import { exitWatchKit } from "./exit-watch-kit";

const parsed = (seq: number) => parseExitProof(fullProof(seq));

describe("ExitKeeper", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => { kit = exitWatchKit(); });

  describe("what leaves the last verified proof in place", () => {
    beforeEach(async () => {
      await kit.connect();
      kit.exit.vault = factsAt(200);
    });
    const record = () => kit.store.getSnapshot().exit.record;
    const stored = () => kit.storage.held.get(exitStorageKey(SCOPE)) ?? "";

    it("an answer at another root than the vault's, without asking the verifier", async () => {
      kit.client.exitAnswer = fullProof(300);
      kit.exit.checks = [];
      await kit.store.exit.refresh();
      expect(kit.exit.checks).toEqual([]);
      expect(record()?.proof.seq).toBe(100);
      expect(stored()).toContain(`"seq":100`);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "node-ahead", nodeSeq: 300 });
      expect(kit.client.exitReads).toBe(2);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(2); // the next read is for the vault's next root
    });

    it("an answer that catches up when the vault has moved to it since its last read", async () => {
      kit.client.exitAnswer = fullProof(300);
      await kit.store.exit.refresh();
      kit.exit.vault = factsAt(300);
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(300);
      expect(kit.store.getSnapshot().exit.attempt).toBeNull();
    });

    it("a proof the verifier refuses, which is not saved and says why", async () => {
      kit.client.exitAnswer = fullProof(200);
      kit.exit.verdict = () => ({ ok: false, reason: "its exit terms does not prove against the vault's root" });
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(100);
      expect(stored()).toContain(`"seq":100`);
      expect(kit.store.getSnapshot().exit.attempt?.kind).toBe("refused");
    });

    it("an answer that does not read as a proof", async () => {
      kit.client.exitAnswer = { seq: "nonsense" };
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "refused", reason: "seq is not a whole number" });
    });

    it("a node read that fails, which another read of the vault alone does not repeat", async () => {
      kit.client.exitError = new EngineError(0, "The node did not answer.");
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "node-failed", reason: "The node did not answer." });
      const reads = kit.client.exitReads;
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(reads);
    });

    it("an answer that does not verify, as a node read that fails", async () => {
      kit.client.exitError = new UntrustedError("The node is not verified.");
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "node-failed", reason: "The node is not verified." });
    });

    it("a wallet that cannot check it, which the next read of the vault tries again with no new signature", async () => {
      kit.client.exitAnswer = fullProof(200);
      kit.exit.checkError = new Error("Your wallet did not answer in time.");
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "wallet-failed", reason: "Your wallet did not answer in time." });
      const reads = kit.client.exitReads;
      // Trading goes on: each change to the account must not cost the node another signature.
      kit.store.patch({ account: { balance: 2_000n, unfinalised: 0n, equity: 2_000n, margin: 0n, positions: [], orders: [] } });
      await settle();
      expect(kit.client.exitReads).toBe(reads);
      kit.exit.checkError = null;
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(200);
      expect(kit.client.exitReads).toBe(reads);
    });

    it("an older answer the wallet could check only after the vault moved on, leaving the vault's new root to be read", async () => {
      kit.client.exitAnswer = fullProof(200);
      kit.exit.checkError = new Error("no answer");
      await kit.store.exit.refresh();
      const reads = kit.client.exitReads;
      kit.exit.checkError = null;
      kit.exit.vault = factsAt(300);
      kit.client.exitAnswer = fullProof(300);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(reads + 1);
      expect(record()?.proof.seq).toBe(300);
    });

    it("a vault read that fails, which reads the node for nothing", async () => {
      kit.exit.factsError = new Error("your wallet is on chain 1, not chain 31337");
      const reads = kit.client.exitReads;
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(reads);
      expect(record()?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.vaultProblem).toBe("your wallet is on chain 1, not chain 31337");
    });

    it("the node's 404 before its first checkpoint under the exit", async () => {
      kit.client.exitAnswer = null;
      await kit.store.exit.refresh();
      expect(record()?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "no-proof" });
    });
  });

  describe("a balance under one USDC base unit, which a full withdrawal leaves", () => {
    it("holds nothing: the old proof goes, the page says so, and the node is not read again", async () => {
      await kit.connect();
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = emptyProof(200);
      kit.store.patch({ account: { balance: 412n, unfinalised: 0n, equity: 412n, margin: 0n, positions: [], orders: [] } });
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit).toMatchObject({ nothing: true, record: null, attempt: null });
      const reads = kit.client.exitReads;
      kit.exit.vault = factsAt(300);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(reads);
      expect(kit.store.getSnapshot().exit.nothing).toBe(true);
    });
  });

  describe("an answer ahead of the vault", () => {
    it("is kept, and checked when the vault reaches it, at no signature, with the node gone by then", async () => {
      await kit.connect();
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(300);
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "node-ahead", nodeSeq: 300 });
      const reads = kit.client.exitReads;
      kit.client.exitError = new Error("the node is gone");
      kit.exit.vault = factsAt(300);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(reads);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(300);
    });
    it("gives way to a new read once the vault has passed it", async () => {
      await kit.connect();
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(300);
      await kit.store.exit.refresh();
      kit.client.exitAnswer = fullProof(400);
      kit.exit.vault = factsAt(400);
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(400);
    });
  });

  describe("a move to another node", () => {
    it("brings along an answer the wallet has not checked yet, which costs no new signature", async () => {
      await kit.connect();
      kit.client.exitAnswer = fullProof(200);
      kit.exit.vault = factsAt(200);
      kit.exit.checkError = new Error("no answer");
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.attempt?.kind).toBe("wallet-failed");
      const next = exitWatchKit();
      next.exit.vault = factsAt(200);
      next.client.exitError = new Error("the successor is not up");
      next.store.exit.keeper.carry(kit.store.getSnapshot().exit, kit.store.exit.keeper);
      await next.connect();
      expect(next.client.exitReads).toBe(0);
      expect(next.store.getSnapshot().exit.record?.proof.seq).toBe(200);
    });

    it("brings along a proof the browser would not keep, for the same account and deployment", async () => {
      kit.storage.refuseWrites = true;
      await kit.connect();
      const next = exitWatchKit();
      next.storage.refuseWrites = true;
      next.store.exit.keeper.carry(kit.store.getSnapshot().exit, kit.store.exit.keeper);
      next.client.exitAnswer = fullProof(300);
      await next.connect();
      const { record, storageProblem } = next.store.getSnapshot().exit;
      expect(record?.proof.seq).toBe(100);
      expect(storageProblem).toBe("this browser's storage refused it: the quota is exceeded");
    });

    it("brings nothing for another account", async () => {
      await kit.connect();
      const next = exitWatchKit();
      const { record, storageProblem } = kit.store.getSnapshot().exit;
      next.store.exit.keeper.carry({ ...kit.store.getSnapshot().exit, record: record === null ? null : { ...record, account: SCOPE.vault }, storageProblem }, kit.store.exit.keeper);
      expect(next.store.exit.keeper.startingFrom(SCOPE).record).toBeNull();
    });
  });

  describe("how long it has been without a proof", () => {
    it("marks when the page first had none at the vault's root, and clears it once it does", async () => {
      kit.client.exitError = new EngineError(0, "The node did not answer.");
      kit.exit.vault = factsAt(100, { chainNow: 5_000 });
      await kit.connect();
      expect(kit.store.getSnapshot().exit.missingSince).toBe(5_000);
      kit.exit.vault = factsAt(200, { chainNow: 6_000 });
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.missingSince).toBe(5_000);
      kit.client.exitError = null;
      kit.client.exitAnswer = fullProof(300);
      kit.exit.vault = factsAt(300, { chainNow: 7_000 });
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.missingSince).toBeNull();
    });
  });

  describe("the node gone", () => {
    it("keeps the saved proof and says so, asking the node nothing", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      await kit.attach({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale" });
      kit.exit.vault = factsAt(200);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(0);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.attempt?.kind).toBe("node-away");
    });

    it("reads the node once when it comes back", async () => {
      await kit.attach({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale", accountRead: true, account: { balance: 1_000n, unfinalised: 0n, equity: 1_000n, margin: 0n, positions: [], orders: [] } });
      expect(kit.client.exitReads).toBe(0);
      kit.store.patch({ attestation: { kind: "mock" }, stream: "live" });
      await settle();
      expect(kit.client.exitReads).toBe(1);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
    });

    it("does not read the node while it is still being checked", async () => {
      await kit.attach({ attestation: { kind: "checking" }, stream: "connecting", accountRead: true, account: { balance: 1_000n, unfinalised: 0n, equity: 1_000n, margin: 0n, positions: [], orders: [] } });
      expect(kit.client.exitReads).toBe(0);
      expect(kit.store.getSnapshot().exit.attempt).toBeNull();
    });
  });
});
