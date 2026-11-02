import { beforeEach, describe, expect, it } from "vitest";

import { accepts, ACCOUNT, emptyProof, factsAt, fullProof, SCOPE } from "../engine/exit-kit";
import { exitStorageKey, parseExitFile, writeStoredExit } from "../engine/exit-file";
import { parseExitProof } from "../engine/exit-proof";
import type { ExitCheck, ExitProof } from "../engine/exit-types";
import { settle } from "../engine/test-kit";
import { exitWatchKit } from "./exit-watch-kit";
import { exitView } from "./exit-view";

const STARTED = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });

describe("ExitKeeper, and what makes a proof empty", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => { kit = exitWatchKit(); });
  const exit = () => kit.store.getSnapshot().exit;
  const saved = () => parseExitFile(kit.storage.held.get(exitStorageKey(SCOPE)) ?? "").proof.seq;
  const { approvals, distribution } = fullProof(100);
  const HOLDING_OLDER = () => writeStoredExit(() => kit.storage, { ...SCOPE, proof: parseExitProof(fullProof(50)), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });

  describe.each<[string, ExitProof, ExitCheck, ExitCheck]>([
    ["its approval", { ...emptyProof(100), approvals }, accepts({ accountClaim: 0n, paidApprovals: [1], finalPaidApprovals: [] }), accepts({ accountClaim: 0n, paidApprovals: [1], finalPaidApprovals: [1] })],
    ["its distribution", { ...emptyProof(100), distribution }, accepts({ accountClaim: 0n, distributionOwed: 0n, finalDistributionOwed: 3_000_000n }), accepts({ accountClaim: 0n, distributionOwed: 0n, finalDistributionOwed: 0n })],
  ])("a proof the payment of %s empties", (_name, proof, atHead, atFinal) => {
    beforeEach(() => {
      HOLDING_OLDER();
      kit.client.exitAnswer = proof;
    });
    it("replaces the record before it, and is kept, while only the chain's head shows the payment", async () => {
      kit.exit.verdict = () => atHead;
      await kit.connect(0n);
      expect(exit().record?.proof.seq).toBe(100);
      expect(saved()).toBe(100);
      expect(exit().nothing).toBe(false);
    });
    it("is not kept, and the record before it goes, once a finalized block shows the payment", async () => {
      kit.exit.verdict = () => atFinal;
      await kit.connect(0n);
      expect(exit().record).toBeNull();
      expect(kit.storage.held.size).toBe(0);
      expect(exit().nothing).toBe(true);
    });
    it("leaves later roots read while it could still be undone", async () => {
      kit.exit.verdict = () => atHead;
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(1);
      kit.exit.vault = factsAt(200);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(2);
    });
  });

  it("asks the node for a withdrawal the vault shows paid, as that read is of the chain's head", async () => {
    kit.store.patch({ paid: [1], history: [{ cursor: "90:0", seq: 90, index: 0, ts: 0, type: "withdrawal_approved", account: ACCOUNT, amount: "10", nonce: 1 }] as never });
    kit.client.exitAnswer = { ...emptyProof(100), approvals };
    kit.exit.verdict = () => accepts({ accountClaim: 0n, paidApprovals: [1], finalPaidApprovals: [] });
    await kit.connect(0n);
    expect(kit.client.exitReads).toBe(1);
    expect(exit().record?.proof.approvals.length).toBe(1);
  });

  it("asks too for an authorization the vault shows paid", async () => {
    kit.store.patch({ paid: [1], authorizations: [{ nonce: 1 }] as never });
    kit.client.exitAnswer = { ...emptyProof(100), approvals };
    await kit.connect(0n);
    expect(kit.client.exitReads).toBe(1);
  });

  describe("a gap the exit terms name", () => {
    const GAP = { id: 1, amount: 25_000_000n };
    const gapped: ExitProof = { ...emptyProof(100), terms: { ...emptyProof(100).terms, terms: { ...emptyProof(100).terms.terms, gaps: [GAP.id] } } };
    const refunds = (held: typeof kit) => exitView(held.store.getSnapshot().exit, { address: ACCOUNT }).refunds;

    it("offers its refund through the read of the vault's record, though the proof holds nothing else", async () => {
      kit.exit.vault = STARTED;
      kit.exit.gapDeposits = [GAP];
      kit.client.exitAnswer = gapped;
      await kit.connect(0n);
      await kit.store.exit.refresh();
      expect(exit().claims?.unheld).toEqual([GAP]);
      expect(refunds(kit)).toEqual([{ kind: "refund-unheld", id: 1, amount: 25_000_000n }]);
    });

    it("still offers it after a reload with the node gone", async () => {
      kit.exit.vault = STARTED;
      kit.client.exitAnswer = gapped;
      await kit.connect(0n);
      const reloaded = exitWatchKit();
      for (const [key, value] of kit.storage.held) reloaded.storage.held.set(key, value);
      reloaded.exit.vault = STARTED;
      reloaded.exit.gapDeposits = [GAP];
      reloaded.client.exitError = new Error("the node is gone");
      await reloaded.attach({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale" });
      await reloaded.store.exit.refresh();
      expect(refunds(reloaded)).toEqual([{ kind: "refund-unheld", id: 1, amount: 25_000_000n }]);
      expect(reloaded.client.exitReads).toBe(0);
    });

    it("is looked for once the exit has started, though nothing the page has read shows a stake", async () => {
      kit.exit.vault = STARTED;
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(0n);
      expect(kit.client.exitReads).toBe(1);
      expect(kit.client.distributionReads).toBe(0);
      expect(exit().nothing).toBe(true);
      await kit.store.exit.refresh();
      expect(kit.client.exitReads).toBe(1);
    });

    it("is not looked for before the exit starts", async () => {
      kit.client.exitAnswer = gapped;
      await kit.connect(0n);
      await settle();
      expect(kit.client.exitReads).toBe(0);
    });
  });
});
