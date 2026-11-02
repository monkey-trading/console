import { beforeEach, describe, expect, it } from "vitest";

import { writeStoredExit } from "../engine/exit-file";
import { ACCOUNT, factsAt, FakeExitWallet, fullProof, OTHER, recordAt, SCOPE } from "../engine/exit-kit";
import { parseExitProof } from "../engine/exit-proof";
import { settle } from "../engine/test-kit";
import type { Wallet } from "../engine/wallet";
import { RETRY_MS, SLOW_READ_MS } from "./exit";
import { startVaultExit } from "./exit-actions";
import { exitWatchKit } from "./exit-watch-kit";

const NEVER = <T>(): Promise<T> => new Promise<T>(() => undefined);
const DUE = 1_000 + 2_592_000;

describe("the exit's reads", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const exit = () => kit.store.getSnapshot().exit;
  const account = (balance: bigint) => ({ balance, unfinalised: 0n, equity: balance, margin: 0n, positions: [], orders: [] });
  beforeEach(() => { kit = exitWatchKit(); });

  describe("while they keep failing", () => {
    /** Waits `total` milliseconds, with every other kind of reason to read arriving each 30 s. */
    async function eventful(total: number) {
      for (let at = 0; at < total; at += 30_000) {
        kit.emit({ type: "feed", status: "stale" });
        kit.emit({ type: "checkpoint", seq: 500 + at, root: "0x00" } as never);
        kit.store.patch({ account: account(1_000_000n + BigInt(at)) });
        await settle();
        await kit.timers.pass(30_000);
      }
    }
    it("makes them only at the retry's pace, whatever else comes", async () => {
      await kit.connect();
      kit.exit.factsError = new Error("wrong chain");
      await kit.store.exit.refresh();
      const reads = kit.exit.factsReads;
      await eventful(600_000); // past the retries at 5, 20, 65, 185 and 485 s, and two slow reads
      const pace = [RETRY_MS[0], RETRY_MS[1], RETRY_MS[2], RETRY_MS[3], RETRY_MS[4]];
      expect(pace.reduce<number>((sum, ms) => sum + (ms ?? 0), 0)).toBeLessThan(600_000);
      expect(kit.exit.factsReads - reads).toBe(pace.length);
    });
    it("adds no wallet or node read on the account's changes, which the retry's next read takes up", async () => {
      writeStoredExit(() => kit.storage, recordAt(100));
      kit.exit.checkError = new Error("no answer");
      await kit.connect(0n);
      const checks = kit.exit.checks.length;
      const distributions = kit.client.distributionReads;
      kit.store.patch({ account: account(5n) });
      await settle();
      kit.store.patch({ account: account(6n) });
      await settle();
      expect(kit.exit.checks.length).toBe(checks);
      expect(kit.client.distributionReads).toBe(distributions);
      await kit.timers.pass(RETRY_MS[0] ?? 0);
      expect(kit.exit.checks.length).toBe(checks + 1);
    });
    it("makes none on a fill in a hidden tab", async () => {
      await kit.connect();
      kit.exit.factsError = new Error("wrong chain");
      await kit.store.exit.refresh();
      kit.hidden = true;
      const reads = kit.exit.factsReads;
      const nodeReads = kit.client.exitReads;
      kit.store.patch({ account: account(5n) });
      await settle();
      await kit.timers.pass(SLOW_READ_MS);
      expect(kit.exit.factsReads).toBe(reads);
      expect(kit.client.exitReads).toBe(nodeReads);
    });
    it("takes an account change up again once a read has answered", async () => {
      await kit.connect(0n);
      kit.exit.factsError = new Error("wrong chain");
      await kit.store.exit.refresh();
      kit.store.patch({ account: account(1_000_000n) });
      await settle();
      expect(kit.client.exitReads).toBe(0);
      kit.exit.factsError = null;
      await kit.timers.pass(RETRY_MS[0] ?? 0);
      expect(kit.client.exitReads).toBe(1);
    });
  });

  describe("readFresh, what an action reads first", () => {
    /** A connected page whose read of the vault has taken its facts, and waits on a node read a test releases. */
    async function readUnderWay() {
      kit.exit.vault = factsAt(100, { chainNow: DUE });
      await kit.connect();
      kit.exit.vault = factsAt(200, { chainNow: DUE });
      let release: () => void = () => undefined;
      const answer = fullProof(200);
      kit.client.exitProof = () => new Promise((resolve) => { release = () => resolve(answer); });
      const running = kit.store.exit.refresh();
      await settle();
      expect(exit().vault?.latestSeq).toBe(200);
      return { running, release: () => release() };
    }

    it("takes its own read after one under way, which may hold what has since changed", async () => {
      const { running, release } = await readUnderWay();
      const lastAt = kit.exit.factsReads;
      kit.exit.vault = factsAt(200, { chainNow: DUE, exitStartedAt: DUE });
      const pressed = startVaultExit(kit.store);
      await settle();
      release();
      await running;
      await pressed;
      expect(kit.exit.factsReads).toBeGreaterThan(lastAt);
      expect(kit.exit.sent).toEqual([]);
      expect(kit.store.getSnapshot().notices.exit?.text).toBe("The vault's exit is not due, so nothing was sent.");
    });
    it("says the vault could not be read when its own read fails, though the one before it answered", async () => {
      const { running, release } = await readUnderWay();
      kit.exit.factsError = new Error("wrong chain");
      const fresh = kit.store.exit.readFresh();
      await settle();
      release();
      await running;
      expect(await fresh).toBe(false);
    });
    it("says so too when a wallet prompt holds the read back", async () => {
      await kit.connect();
      kit.store.patch({ prompt: "Confirm in your wallet." });
      expect(await kit.store.exit.readFresh()).toBe(false);
    });
    it("answers true when its own read does", async () => {
      await kit.connect();
      const before = kit.exit.factsReads;
      expect(await kit.store.exit.readFresh()).toBe(true);
      expect(kit.exit.factsReads).toBe(before + 1);
    });
    it("leaves ordinary reads joining the one under way", async () => {
      const { running, release } = await readUnderWay();
      const reads = kit.exit.factsReads;
      void kit.store.exit.refresh();
      await settle();
      expect(kit.exit.factsReads).toBe(reads);
      release();
      await running;
    });
  });

  describe("a read stuck on a wallet since replaced", () => {
    /** Connects the kit's wallet with `stuck` done to its vault, then moves to another wallet, whose vault reads as the kit's did. */
    async function moving(stuck: (exit: FakeExitWallet) => void) {
      stuck(kit.exit);
      await kit.connect();
      const next = new FakeExitWallet();
      const wallet: Wallet = { ...kit.wallet, address: OTHER, exit: next };
      kit.store.liveWallet = wallet;
      kit.store.patch({ wallet: { address: OTHER, label: "Next" } });
      await settle();
      return next;
    }
    it("does not hold up the next wallet's read of the vault", async () => {
      const next = await moving((held) => { held.facts = () => NEVER(); });
      expect(next.factsReads).toBe(1);
      expect(exit().vault?.latestSeq).toBe(next.vault.latestSeq);
    });
    it("does not hold up its check of what it has saved", async () => {
      const key = { ...SCOPE, account: OTHER };
      writeStoredExit(() => kit.storage, { ...key, proof: parseExitProof(fullProof(100, OTHER)), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parseExitProof(fullProof(100, ACCOUNT)), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      const next = await moving((held) => { held.check = () => NEVER(); });
      expect(next.checks.length).toBe(1);
      expect(exit().checked).toBe(exit().record);
      expect(exit().record?.account).toBe(OTHER);
    });
    it("says nothing on the next wallet's page when it ends", async () => {
      let answer: (value: Awaited<ReturnType<FakeExitWallet["facts"]>>) => void = () => undefined;
      const next = await moving((held) => { held.facts = () => new Promise((resolve) => { answer = resolve; }); });
      const shown = exit().vault;
      answer(factsAt(900));
      await settle();
      expect(exit().vault).toBe(shown);
      expect(next.factsReads).toBe(1);
    });
    it("owes the next wallet no read that was asked of it", async () => {
      kit.exit.facts = () => NEVER();
      await kit.connect();
      void kit.store.exit.refresh(); // joins the stuck read, and asks for another after it
      const next = new FakeExitWallet();
      kit.store.liveWallet = { ...kit.wallet, address: OTHER, exit: next };
      kit.store.patch({ wallet: { address: OTHER, label: "Next" } });
      await settle();
      expect(next.factsReads).toBe(1);
    });
    it("leaves the next wallet's read under way when it ends, so another joins it", async () => {
      let endOld: (value: Awaited<ReturnType<FakeExitWallet["facts"]>>) => void = () => undefined;
      kit.exit.facts = () => new Promise((resolve) => { endOld = resolve; });
      await kit.connect();
      const next = new FakeExitWallet();
      next.facts = () => NEVER();
      kit.store.liveWallet = { ...kit.wallet, address: OTHER, exit: next };
      kit.store.patch({ wallet: { address: OTHER, label: "Next" } });
      await settle();
      const running = kit.store.exit.refresh();
      endOld(factsAt(900));
      await settle();
      expect(kit.store.exit.refresh()).toBe(running);
    });
    it("leaves the next wallet's settle running when it ends, so another waits for it", async () => {
      writeStoredExit(() => kit.storage, { ...SCOPE, proof: parseExitProof(fullProof(100, ACCOUNT)), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      writeStoredExit(() => kit.storage, { ...SCOPE, account: OTHER, proof: parseExitProof(fullProof(100, OTHER)), checkpointAt: 900, accountClaim: 1n, distributionOwed: 0n, paidApprovals: [] });
      let endOld: (value: Awaited<ReturnType<FakeExitWallet["check"]>>) => void = () => undefined;
      kit.exit.check = () => new Promise((resolve) => { endOld = resolve; });
      await kit.connect();
      const next = new FakeExitWallet();
      let checks = 0;
      next.check = () => { checks += 1; return NEVER(); };
      kit.store.liveWallet = { ...kit.wallet, address: OTHER, exit: next };
      kit.store.patch({ wallet: { address: OTHER, label: "Next" } });
      await settle();
      expect(checks).toBe(1);
      endOld({ ok: false, reason: "too late" });
      await settle();
      let asked = false;
      void kit.store.exit.keeper.settle().then(() => { asked = true; }); // it only asks the settle under way for another turn
      await settle();
      expect(asked).toBe(true);
    });
    it("still joins a read of the same wallet", async () => {
      await kit.connect();
      let release: (value: Awaited<ReturnType<FakeExitWallet["facts"]>>) => void = () => undefined;
      let reads = 0;
      kit.exit.facts = () => {
        reads += 1;
        return new Promise((resolve) => { release = resolve; });
      };
      const first = kit.store.exit.refresh();
      void kit.store.exit.refresh();
      await settle();
      expect(reads).toBe(1);
      kit.exit.facts = async () => factsAt(100);
      release(factsAt(100));
      await first;
    });
  });
});
