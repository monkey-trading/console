import { beforeEach, describe, expect, it } from "vitest";

import { EngineError } from "../engine/client";
import { ACCOUNT, emptyProof, factsAt, FakeExitWallet, fullProof, OTHER, SCOPE } from "../engine/exit-kit";
import { writeStoredExit } from "../engine/exit-file";
import { parseExitProof } from "../engine/exit-proof";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { exitWatchKit } from "./exit-watch-kit";

const parsed = (seq: number) => parseExitProof(fullProof(seq));

describe("ExitKeeper, and what it spares the node", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => { kit = exitWatchKit(); });

  describe("an account with nothing at stake", () => {
    it("is not read from the node at all", async () => {
      await kit.connect(0n);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(0);
      expect(kit.store.getSnapshot().exit.nothing).toBe(true);
      expect(kit.exit.checks).toEqual([]);
    });

    it("is read once it has a balance", async () => {
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(0);
      kit.store.patch({ account: { balance: 100_000n, unfinalised: 0n, equity: 100_000n, margin: 0n, positions: [], orders: [] } });
      await settle();
      expect(kit.client.exitReads).toBe(1);
      expect(kit.store.getSnapshot().exit.nothing).toBe(false);
    });

    it("asks once per connection whether a past staker is owed a distribution, and reads the proof when it is", async () => {
      kit.client.distributionAnswer = { seq: 100, root: "0x00", account: ACCOUNT, entitled: "3000000", siblings: [] };
      kit.client.exitAnswer = { ...emptyProof(100), distribution: fullProof(100).distribution };
      await kit.connect(0n);
      expect(kit.client.distributionReads).toBe(1);
      expect(kit.client.exitReads).toBe(1);
      expect(kit.store.getSnapshot().exit.record?.proof.distribution?.entitled).toBe("3000000");
    });

    it("does not read the proof when the node holds no distribution either, and asks only once", async () => {
      await kit.connect(0n);
      kit.exit.vault = factsAt(200);
      await kit.store.exit.refresh();
      expect(kit.client.distributionReads).toBe(1);
      expect(kit.client.exitReads).toBe(0);
      expect(kit.store.getSnapshot().exit.nothing).toBe(true);
    });

    it("does not say it holds nothing when the node could not say about a distribution", async () => {
      kit.client.distributionError = new EngineError(0, "The node did not answer.");
      await kit.connect(0n);
      expect(kit.store.getSnapshot().exit.nothing).toBe(false);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "node-failed", reason: "The node did not answer." });
    });

    it("counts a queued withdrawal in its history, which one page of the queue can miss", async () => {
      kit.store.patch({ history: [{ cursor: "90:0", seq: 90, index: 0, ts: 0, type: "withdrawal_queued", account: ACCOUNT, amount: "10", requested_seq: 90 }] as never });
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(1);
      expect(kit.client.distributionReads).toBe(0);
    });

    it("stops saying it holds nothing once it is credited, at the same root", async () => {
      await kit.connect(0n);
      expect(kit.store.getSnapshot().exit.nothing).toBe(true);
      kit.client.exitAnswer = emptyProof(100);
      kit.store.patch({ account: { balance: 5_000n, unfinalised: 0n, equity: 5_000n, margin: 0n, positions: [], orders: [] } });
      await settle();
      expect(kit.store.getSnapshot().exit.nothing).toBe(false);
      expect(kit.store.getSnapshot().exit.attempt).toEqual({ kind: "not-covered" });
    });

    it("asks about a distribution again after the node was away, as a stake may have come and gone", async () => {
      await kit.connect(0n);
      expect(kit.client.distributionReads).toBe(1);
      kit.store.patch({ stream: "stale" });
      await settle();
      kit.store.patch({ stream: "live" });
      await settle();
      expect(kit.client.distributionReads).toBe(2);
    });

    it("leaves what one wallet's distribution read comes to out of the next wallet's connection", async () => {
      let answer: (value: null) => void = () => undefined;
      const { stats } = kit.client;
      const asked = stats.distributions;
      stats.distributions = () => new Promise((resolve) => { answer = resolve; });
      await kit.connect(0n);
      const other: Wallet = { ...kit.wallet, address: OTHER, exit: new FakeExitWallet() };
      stats.distributions = asked;
      kit.client.distributionAnswer = { seq: 100, root: "0x00", account: OTHER, entitled: "5", siblings: [] };
      kit.client.exitAnswer = emptyProof(100);
      kit.store.liveWallet = other;
      kit.store.patch({ wallet: { address: OTHER, label: "Test" } });
      answer(null);
      await settle();
      expect(kit.client.distributionReads).toBe(1); // the second wallet asked for itself, despite the first's answer landing after it connected
    });

    it("is read while it has a stake the account read cannot show", async () => {
      kit.exit.staked = true;
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(1);
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = emptyProof(200);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(2); // a distribution can arrive at any checkpoint
    });

    it("stops reading after an answer that covers everything and holds nothing, until the account does something", async () => {
      kit.store.patch({ history: [{ cursor: "90:0", seq: 90, index: 0, ts: 0, type: "withdrawal_approved", account: ACCOUNT, amount: "10", nonce: 1 }] as never });
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(1);
      expect(kit.store.getSnapshot().exit.nothing).toBe(true);
      kit.exit.vault = factsAt(200);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(1);
      kit.store.patch({ history: [{ cursor: "150:0", seq: 150, index: 0, ts: 0, type: "deposit_pending", chain_ref: "x", account: ACCOUNT, payer: ACCOUNT, amount: "10", reason: "x" }] as never });
      await settle();
      expect(kit.client.exitReads).toBe(2);
    });

    it("keeps reading after an empty answer at a checkpoint older than the account's newest event, which it could not have held", async () => {
      kit.store.patch({ history: [{ cursor: "150:0", seq: 150, index: 0, ts: 0, type: "deposit_pending", chain_ref: "x", account: ACCOUNT, payer: ACCOUNT, amount: "10", reason: "x" }] as never });
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(1);
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(2);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
    });

    it("does not say a funded account holds nothing because the vault's root predates its funds", async () => {
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(1000n);
      const { nothing, attempt } = kit.store.getSnapshot().exit;
      expect(nothing).toBe(false);
      expect(attempt).toEqual({ kind: "not-covered" });
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
    });

    describe("before its history has landed", () => {
      const PENDING = { cursor: "90:0", seq: 90, index: 0, ts: 0, type: "deposit_pending", chain_ref: "x", account: ACCOUNT, payer: ACCOUNT, amount: "10", reason: "x" };
      const waiting = (accountHistory: "waiting" | "failed") => kit.attach({ attestation: { kind: "mock" }, stream: "live", accountRead: true, accountHistory, account: null });

      it("says nothing of it, and spends no read, while the first read is out", async () => {
        await waiting("waiting");
        expect(kit.store.getSnapshot().exit.nothing).toBe(false);
        expect(kit.client.distributionReads).toBe(0);
        expect(kit.client.exitReads).toBe(0);
      });
      it("reads the proof once the history shows a pending deposit, with no distribution read", async () => {
        await waiting("waiting");
        kit.client.exitAnswer = fullProof(100);
        kit.store.patch({ history: [PENDING] as never, accountHistory: "read" });
        await settle();
        expect(kit.client.exitReads).toBe(1);
        expect(kit.client.distributionReads).toBe(0);
        expect(kit.store.getSnapshot().exit.nothing).toBe(false);
      });
      it("says it holds nothing once an empty history lands", async () => {
        await waiting("waiting");
        kit.store.patch({ accountHistory: "read" });
        await settle();
        expect(kit.store.getSnapshot().exit.nothing).toBe(true);
        expect(kit.client.distributionReads).toBe(1);
      });
      it("does not count a history that could not be read as empty, and asks the node instead", async () => {
        kit.client.exitAnswer = emptyProof(100);
        await waiting("failed");
        expect(kit.client.exitReads).toBe(1);
        expect(kit.client.distributionReads).toBe(0);
        expect(kit.store.getSnapshot().exit.nothing).toBe(false);
      });
      it("says it holds nothing once a history that could not be read has landed empty", async () => {
        kit.client.exitAnswer = emptyProof(100);
        await waiting("failed");
        kit.store.patch({ accountHistory: "read" });
        await settle();
        expect(kit.store.getSnapshot().exit.nothing).toBe(true);
      });
      it("does not make an account that shows funds wait for it", async () => {
        await kit.attach({ attestation: { kind: "mock" }, stream: "live", accountRead: true, account: { balance: 100_000n, unfinalised: 0n, equity: 100_000n, margin: 0n, positions: [], orders: [] } });
        expect(kit.store.getSnapshot().accountHistory).toBe("waiting");
        expect(kit.client.exitReads).toBe(1);
      });
    });

    it("removes the saved proof once the vault's root shows it holds nothing", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(50), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(0n);
      expect(kit.store.getSnapshot().exit.record).toBeNull();
      expect(kit.storage.held.size).toBe(0);
    });
  });
});
