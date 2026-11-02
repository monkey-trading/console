import { beforeEach, describe, expect, it } from "vitest";

import { accepts, emptyProof, factsAt, fullProof, SCOPE } from "../engine/exit-kit";
import { exitStorageKey, parseExitFile, writeStoredExit } from "../engine/exit-file";
import { parseExitProof } from "../engine/exit-proof";
import { settle } from "../engine/test-kit";
import { exitWatchKit } from "./exit-watch-kit";

const parsed = (seq: number) => parseExitProof(fullProof(seq));

describe("ExitKeeper, and what a browser keeps", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => { kit = exitWatchKit(); });

  describe("storage", () => {
    it("says so when the browser will not keep a proof, and keeps it in the page for export", async () => {
      kit.storage.refuseWrites = true;
      await kit.connect();
      const { record, storageProblem } = kit.store.getSnapshot().exit;
      expect(record?.proof.seq).toBe(100);
      expect(storageProblem).toBe("this browser's storage refused it: the quota is exceeded");
    });

    it("clears the warning once a later proof is kept", async () => {
      kit.storage.refuseWrites = true;
      await kit.connect();
      kit.storage.refuseWrites = false;
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.storageProblem).toBeNull();
    });

    it("says so when the saved value cannot be read, and clears that once it reads the node for a good one", async () => {
      kit.storage.held.set(exitStorageKey(SCOPE), "{corrupt");
      await kit.attach({ attestation: { kind: "checking" }, stream: "connecting" });
      expect(kit.store.getSnapshot().exit.storageProblem).toMatch(/could not be read: it is not JSON/);
      kit.store.patch({ attestation: { kind: "mock" }, stream: "live", accountRead: true, account: { balance: 1_000n, unfinalised: 0n, equity: 1_000n, margin: 0n, positions: [], orders: [] } });
      await settle();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.storageProblem).toBeNull();
    });

    it("has the vault's verifier judge a stored proof once per connection, taking its figures from that answer and no signature from the node", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      await kit.connect();
      expect(kit.exit.checks).toEqual([fullProof(100).root]);
      const { record, attempt } = kit.store.getSnapshot().exit;
      expect(record?.accountClaim).toBe(5_010_000_000n);
      expect(record?.distributionOwed).toBe(3_000_000n);
      expect(record?.checkpointAt).toBe(1_000);
      expect(attempt).toBeNull();
      await kit.store.exit.refresh();
      expect(kit.exit.checks).toEqual([fullProof(100).root]);
      expect(kit.client.exitReads).toBe(0);
      expect(record !== null && kit.store.getSnapshot().exit.checked === record).toBe(true);
    });

    it("removes a stored proof the vault's verifier refuses, says so, and reads the node for a good one", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      kit.exit.verdict = (_proof, root) => (kit.exit.checks.length === 1 ? { ok: false, reason: `the root ${root} does not prove it` } : accepts({ accountClaim: 7n }));
      await kit.connect();
      expect(kit.client.exitReads).toBe(1);
      expect(kit.store.getSnapshot().exit.record?.accountClaim).toBe(7n);
      expect(kit.storage.held.get(exitStorageKey(SCOPE))).toContain(`"account_claim":"7"`);
    });

    it("says a stored proof was removed when the node cannot replace it", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      kit.exit.verdict = () => ({ ok: false, reason: "the vault's root does not prove its exit terms" });
      await kit.attach({ attestation: { kind: "unverified", reason: "gone" }, stream: "stale" });
      expect(kit.store.getSnapshot().exit.record).toBeNull();
      expect(kit.storage.held.size).toBe(0);
    });

    it("does not count a stored proof until a wallet that failed can check it", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      kit.exit.checkError = new Error("no answer");
      await kit.connect();
      const { record, attempt } = kit.store.getSnapshot().exit;
      expect(attempt).toEqual({ kind: "wallet-failed", reason: "no answer" });
      expect(record !== null && kit.store.getSnapshot().exit.checked === record).toBe(false);
      expect(kit.client.exitReads).toBe(0);
    });

    it("does not let a check of an older root replace a later proof another tab saved meanwhile", async () => {
      await kit.connect();
      kit.exit.vault = factsAt(200);
      kit.client.exitAnswer = fullProof(200);
      kit.exit.verdict = () => {
        kit.exit.vault = factsAt(300);
        writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(300), checkpointAt: 1_300, accountClaim: 9n, distributionOwed: 0n, paidApprovals: [] });
        return accepts({ accountClaim: 1n });
      };
      await kit.store.exit.refresh();
      expect(kit.storage.held.get(exitStorageKey(SCOPE))).toContain(`"seq":300`);
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(300);
    });

    it("does not let a stored seq the vault has never held block a proof at the vault's latest root", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(9_000), checkpointAt: 1, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      await kit.connect();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
      expect(kit.storage.held.get(exitStorageKey(SCOPE))).toContain(`"seq":100`);
    });

    it("refuses a stored proof whose seq the vault does not hold for its root", async () => {
      const proof = parseExitProof(fullProof(100));
      const renamed = JSON.parse(JSON.stringify(proof).replaceAll(`"seq":100`, `"seq":9000`)) as typeof proof;
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: renamed, checkpointAt: 1, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      await kit.attach({ attestation: { kind: "unverified", reason: "gone" }, stream: "stale" });
      const { record, attempt } = kit.store.getSnapshot().exit;
      expect(record).toBeNull();
      expect(attempt).toEqual({ kind: "saved-refused", reason: "it names checkpoint 9000 for the root of checkpoint 100" });
      expect(kit.exit.checks).toEqual([]);
    });

    it("does not refuse a good stored proof because a post landed between the vault's two reads", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(100), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      const answers = [factsAt(100, { latestSeq: 99 }), factsAt(100)];
      kit.exit.facts = async () => answers.shift() ?? factsAt(100);
      await kit.attach({ attestation: { kind: "unverified", reason: "gone" }, stream: "stale" });
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
      expect(kit.store.getSnapshot().exit.attempt).toBeNull();
    });

    it("takes a newer proof another tab saved, rather than read the node for it", async () => {
      await kit.connect();
      const reads = kit.client.exitReads;
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(200), checkpointAt: 1_100, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      kit.exit.vault = factsAt(200);
      await kit.store.exit.refresh();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
      expect(kit.client.exitReads).toBe(reads);
    });

    it("works with no storage at all", async () => {
      kit.denyStorage();
      await kit.connect();
      expect(kit.store.getSnapshot().exit.storageProblem).toBe("this browser's storage is not available: denied");
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
    });
  });

  describe("what it deletes, with another tab saving meanwhile", () => {
    const saving = (seq: number) => writeStoredExit(() => kit.storage, { ...SCOPE, proof: parsed(seq), checkpointAt: 1_100, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
    const savedSeq = () => parseExitFile(kit.storage.held.get(exitStorageKey(SCOPE)) ?? "").proof.seq;
    /** A proof at the vault's root the verifier refuses, with `meanwhile` run as it does. */
    const refusing = (meanwhile: () => void) => {
      saving(100);
      kit.exit.verdict = () => {
        meanwhile();
        return { ok: false, reason: "the root does not prove it" };
      };
    };

    it("keeps a later proof saved while an empty answer was checked, and does not say the account holds nothing", async () => {
      saving(50);
      kit.client.exitAnswer = emptyProof(100);
      kit.exit.verdict = () => {
        saving(200);
        return accepts({ accountClaim: 0n });
      };
      await kit.connect(0n);
      expect(savedSeq()).toBe(200);
      expect(kit.store.getSnapshot().exit.nothing).toBe(false);
    });
    it("still removes an older proof when nothing later was saved", async () => {
      saving(50);
      kit.client.exitAnswer = emptyProof(100);
      await kit.connect(0n);
      expect(kit.storage.held.size).toBe(0);
      expect(kit.store.getSnapshot().exit.record).toBeNull();
    });
    it("removes the saved proof the verifier refused", async () => {
      refusing(() => undefined);
      kit.client.exitError = new Error("the node is gone");
      await kit.connect();
      expect(kit.storage.held.size).toBe(0);
      expect(kit.store.getSnapshot().exit.record).toBeNull();
    });
    it("keeps a proof saved while the verifier was refusing an older copy", async () => {
      refusing(() => saving(200));
      kit.client.exitError = new Error("the node is gone");
      await kit.connect();
      expect(savedSeq()).toBe(200);
    });
    it("keeps the page's record when it has moved on from the proof refused", async () => {
      refusing(() => {
        const { exit } = kit.store.getSnapshot();
        kit.store.patch({ exit: { ...exit, record: { ...SCOPE, proof: parsed(200), checkpointAt: 1_100, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] } } });
      });
      kit.client.exitError = new Error("the node is gone");
      await kit.connect();
      expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
    });
  });
});
