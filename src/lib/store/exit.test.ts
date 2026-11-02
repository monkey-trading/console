import { beforeEach, describe, expect, it } from "vitest";

import { factsAt, FakeExitWallet, fullProof, OTHER, rootAt, SCOPE } from "../engine/exit-kit";
import { exitStorageKey, writeStoredExit } from "../engine/exit-file";
import { parseExitProof } from "../engine/exit-proof";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { CHASE_MS, SLOW_READ_MS } from "./exit";
import { exitWatchKit } from "./exit-watch-kit";

const parsed = (seq: number) => parseExitProof(fullProof(seq));

describe("ExitWatch", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => { kit = exitWatchKit(); });

  describe("a proof at the vault's latest root", () => {
    it("is checked against the vault's root and saved", async () => {
      await kit.connect();
      expect(kit.exit.checks).toEqual([rootAt(100)]);
      const { record, attempt } = kit.store.getSnapshot().exit;
      expect(record?.proof).toEqual(parsed(100));
      expect(record?.checkpointAt).toBe(1_000);
      expect(attempt).toBeNull();
      expect(kit.storage.held.has(exitStorageKey(SCOPE))).toBe(true);
    });

    it("is read once per posted checkpoint, however many times the vault is read", async () => {
      await kit.connect();
      expect(kit.client.exitReads).toBe(1);
      await kit.store.exit.refresh();
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(1);
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      await kit.store.exit.refresh();
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(2);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
    });

    it("is not read from the node when this browser already holds it, as after a reload or in another tab", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      await kit.connect();
      expect(kit.client.exitReads).toBe(0);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
    });
  });

  describe("no timer reads the node", () => {
    it("reads the vault every five minutes while visible, and the node only for a new root", async () => {
      await kit.connect();
      const before = kit.exit.factsReads;
      await kit.timers.pass(SLOW_READ_MS * 3);
      expect(kit.exit.factsReads).toBe(before + 3);
      expect(kit.client.exitReads).toBe(1);
    });

    it("skips the slow read in a hidden tab", async () => {
      await kit.connect();
      kit.hidden = true;
      const before = kit.exit.factsReads;
      await kit.timers.pass(SLOW_READ_MS * 2);
      expect(kit.exit.factsReads).toBe(before);
    });

    it("reads the vault again when a tab is seen, unless it was just read", async () => {
      await kit.connect();
      const before = kit.exit.factsReads;
      await kit.timers.pass(10_000);
      kit.store.exit.seen();
      await settle();
      expect(kit.exit.factsReads).toBe(before);
      await kit.timers.pass(30_000);
      kit.store.exit.seen();
      await settle();
      expect(kit.exit.factsReads).toBe(before + 1);
    });
  });

  describe("a checkpoint on the stream", () => {
    it("reads the vault until it holds that checkpoint, then the node once", async () => {
      await kit.connect();
      const before = kit.exit.factsReads;
      kit.client.exitAnswer = fullProof(200);
      kit.emit({ type: "checkpoint", seq: 200 });
      await kit.timers.pass(CHASE_MS[0] ?? 0);
      expect(kit.exit.factsReads).toBe(before + 1);
      expect(kit.client.exitReads).toBe(1); // the vault has not posted it yet
      kit.exit.vault = factsAt(200);
      await kit.timers.pass(CHASE_MS[1] ?? 0);
      expect(kit.client.exitReads).toBe(2);
      const reads = kit.exit.factsReads;
      await kit.timers.pass(180_000);
      expect(kit.exit.factsReads).toBe(reads); // caught up: nothing further is chased
    });

    it("gives up after its last read, leaving the slow read", async () => {
      await kit.connect();
      kit.hidden = true; // the slow read stands aside, and the chase does not: a background tab keeps its proof current
      const before = kit.exit.factsReads;
      kit.emit({ type: "checkpoint", seq: 200 });
      await kit.timers.pass(CHASE_MS.reduce((a, b) => a + b, 0) * 2);
      expect(kit.exit.factsReads).toBe(before + CHASE_MS.length);
    });

    it("reads the vault at once when the feed stops", async () => {
      await kit.connect();
      const before = kit.exit.factsReads;
      kit.emit({ type: "feed", status: "stale" });
      await settle();
      expect(kit.exit.factsReads).toBe(before + 1);
    });
  });

  describe("the connection", () => {
    it("starts afresh for another account, with that account's own proof", async () => {
      await kit.connect();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
      const other: Wallet = { ...kit.wallet, address: OTHER, exit: new FakeExitWallet() };
      kit.client.exitAnswer = fullProof(100, OTHER);
      kit.store.liveWallet = other;
      kit.store.patch({ wallet: { address: OTHER, label: "Test" } });
      await settle();
      expect(kit.store.getSnapshot().exit.record?.account).toBe(OTHER);
      expect(kit.store.getSnapshot().exit.record?.proof.account?.account).toBe(OTHER);
      expect(kit.storage.held.size).toBe(2);
    });

    it("forgets the proof when the wallet goes, and keeps it in storage", async () => {
      await kit.connect();
      kit.store.liveWallet = null;
      kit.store.patch({ wallet: null });
      await settle();
      expect(kit.store.getSnapshot().exit.record).toBeNull();
      expect(kit.store.getSnapshot().exit.vault).toBeNull();
      expect(kit.storage.held.size).toBe(1);
    });

    it("drops what an account's reads come to once another has connected", async () => {
      await kit.connect();
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      const pending = kit.store.exit.refresh();
      const other: Wallet = { ...kit.wallet, address: OTHER, exit: new FakeExitWallet() };
      kit.store.liveWallet = other;
      kit.store.patch({ wallet: { address: OTHER, label: "Test" } });
      await pending;
      await settle();
      expect(kit.store.getSnapshot().exit.record?.account ?? OTHER).toBe(OTHER);
    });

    it("waits for a wallet prompt before reading through the wallet, then reads", async () => {
      await kit.connect();
      kit.store.patch({ prompt: "Confirm in your wallet." });
      const before = kit.exit.factsReads;
      await kit.store.exit.refresh();
      expect(kit.exit.factsReads).toBe(before);
      kit.store.patch({ prompt: null });
      await settle();
      expect(kit.exit.factsReads).toBe(before + 1);
    });

    it("keeps nothing for a wallet that reads no chain", async () => {
      await kit.attach({}, { address: kit.wallet.address, label: "Read-only", readOnly: true, sign: kit.wallet.sign, deposit: kit.wallet.deposit, claim: kit.wallet.claim });
      expect(kit.store.getSnapshot().exit.vault).toBeNull();
      expect(kit.client.exitReads).toBe(0);
    });
  });

  describe("the vault's exit", () => {
    it("reads what the vault holds for the proof, with no node", async () => {
      await kit.connect();
      kit.exit.vault = factsAt(100, { exitStartedAt: 2_000, chainNow: 2_100 });
      kit.exit.claimsHeld = { ...kit.exit.claimsHeld, exitClaim: 9n };
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.claims?.exitClaim).toBe(9n);
    });

    it("reads what the vault holds of the proof's parts again once a proof arrives", async () => {
      kit.exit.vault = factsAt(100, { exitStartedAt: 2_000, chainNow: 2_100 });
      kit.exit.claimsHeld = { ...kit.exit.claimsHeld, refunded: [2] };
      await kit.attach({ attestation: { kind: "unverified", reason: "gone" }, stream: "stale" });
      expect(kit.store.getSnapshot().exit.claims?.refunded).toEqual([]);
      await kit.store.exit.keeper.adopter.adopt(kit.wallet, SCOPE, parsed(100));
      expect(kit.store.getSnapshot().exit.claims?.refunded).toEqual([2]);
    });

    it("reads what is registered with no proof at the exit's root, since a claim needs none", async () => {
      kit.exit.vault = factsAt(100, { exitStartedAt: 2_000, chainNow: 2_100 });
      kit.exit.claimsHeld = { ...kit.exit.claimsHeld, exitClaim: 9n };
      await kit.attach({ attestation: { kind: "unverified", reason: "gone" }, stream: "stale" });
      expect(kit.store.getSnapshot().exit.record).toBeNull();
      expect(kit.store.getSnapshot().exit.claims?.exitClaim).toBe(9n);
    });
  });
});
