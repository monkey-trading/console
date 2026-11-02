import { beforeEach, describe, expect, it } from "vitest";

import { factsAt, fullProof } from "../engine/exit-kit";
import { settle } from "../engine/test-kit";
import { RETRY_MS, SLOW_READ_MS } from "./exit";
import { exitWatchKit } from "./exit-watch-kit";

describe("a read that failed, which nobody has to press anything for", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  beforeEach(() => {
    kit = exitWatchKit();
  });

  const wait = (step: number) => RETRY_MS[step] ?? 0;
  it("reads the vault again by itself, further apart each time, until one answers", async () => {
    await kit.connect();
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    let reads = kit.exit.factsReads;
    for (const step of [0, 1, 2, 3]) {
      await kit.timers.pass(wait(step) - 1);
      expect(kit.exit.factsReads).toBe(reads);
      await kit.timers.pass(1);
      reads += 1;
      expect(kit.exit.factsReads).toBe(reads);
    }
    kit.exit.factsError = null;
    await kit.timers.pass(wait(4));
    expect(kit.store.getSnapshot().exit.vaultProblem).toBeNull();
    const answered = kit.exit.factsReads;
    await kit.timers.pass(wait(0) * 2);
    expect(kit.exit.factsReads).toBe(answered);
  });

  it("starts from the shortest wait the next time one fails", async () => {
    await kit.connect();
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    await kit.timers.pass(wait(0) + wait(1));
    kit.exit.factsError = null;
    await kit.timers.pass(wait(2));
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    const reads = kit.exit.factsReads;
    await kit.timers.pass(wait(0));
    expect(kit.exit.factsReads).toBe(reads + 1);
  });

  it("makes none in a hidden tab, and goes on once it is seen", async () => {
    await kit.connect();
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    kit.hidden = true;
    kit.store.patch({});
    const reads = kit.exit.factsReads;
    await kit.timers.pass(SLOW_READ_MS * 2);
    expect(kit.exit.factsReads).toBe(reads);
    kit.hidden = false;
    kit.exit.factsError = null;
    kit.store.exit.seen();
    await settle();
    expect(kit.exit.factsReads).toBe(reads + 1);
    expect(kit.store.getSnapshot().exit.vaultProblem).toBeNull();
  });

  it("makes none once the wallet has gone", async () => {
    await kit.connect();
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    kit.store.liveWallet = null;
    kit.store.patch({ wallet: null });
    await settle();
    const reads = kit.exit.factsReads;
    await kit.timers.pass(wait(0) * 4);
    expect(kit.exit.factsReads).toBe(reads);
  });

  it("reads the node again after a read of it failed, and no further once it answers", async () => {
    kit.client.exitError = new Error("the node stumbled");
    await kit.connect();
    expect(kit.store.getSnapshot().exit.attempt?.kind).toBe("node-failed");
    const reads = kit.client.exitReads;
    kit.client.exitError = null;
    await kit.timers.pass(wait(0));
    expect(kit.client.exitReads).toBe(reads + 1);
    expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(100);
    await kit.timers.pass(wait(1) + wait(2));
    expect(kit.client.exitReads).toBe(reads + 1);
  });

  it("has the wallet check an answer it could not, with the node gone and no new signature", async () => {
    await kit.connect();
    kit.client.exitAnswer = fullProof(200);
    kit.exit.vault = factsAt(200);
    kit.exit.checkError = new Error("no answer");
    await kit.store.exit.refresh();
    expect(kit.store.getSnapshot().exit.attempt?.kind).toBe("wallet-failed");
    const reads = kit.client.exitReads;
    kit.store.patch({ stream: "stale" });
    kit.client.exitError = new Error("the node is gone");
    kit.exit.checkError = null;
    await kit.timers.pass(wait(0));
    expect(kit.client.exitReads).toBe(reads);
    expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
  });

  it("keeps an answer it holds when the node comes back, with no new signature", async () => {
    await kit.connect();
    kit.client.exitAnswer = fullProof(200);
    kit.exit.vault = factsAt(200);
    kit.exit.checkError = new Error("no answer");
    await kit.store.exit.refresh();
    const reads = kit.client.exitReads;
    kit.store.patch({ stream: "stale" });
    await settle();
    kit.store.patch({ stream: "live" });
    await settle();
    expect(kit.client.exitReads).toBe(reads);
    kit.exit.checkError = null;
    await kit.timers.pass(wait(0));
    expect(kit.client.exitReads).toBe(reads);
    expect(kit.store.getSnapshot().exit.record?.proof.seq).toBe(200);
  });

  it("makes no read at all on a checkpoint or a stopped feed in a hidden tab already failing", async () => {
    await kit.connect();
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    kit.hidden = true;
    kit.store.patch({});
    const reads = kit.exit.factsReads;
    kit.emit({ type: "checkpoint", seq: 200 });
    kit.emit({ type: "feed", status: "stale" });
    await kit.timers.pass(SLOW_READ_MS * 2);
    expect(kit.exit.factsReads).toBe(reads);
  });

  it("leaves reads that are failing to the retry's pace, whatever a checkpoint says", async () => {
    await kit.connect();
    kit.exit.factsError = new Error("wrong chain");
    await kit.store.exit.refresh();
    const reads = kit.exit.factsReads;
    kit.emit({ type: "checkpoint", seq: 200 });
    await kit.timers.pass(wait(0) - 1);
    expect(kit.exit.factsReads).toBe(reads);
    await kit.timers.pass(1);
    expect(kit.exit.factsReads).toBe(reads + 1);
    kit.emit({ type: "checkpoint", seq: 300 });
    await kit.timers.pass(wait(1) - 1);
    expect(kit.exit.factsReads).toBe(reads + 1);
  });

  it("stops a checkpoint's chase in a hidden tab once its reads fail", async () => {
    await kit.connect();
    kit.hidden = true;
    kit.exit.factsError = new Error("wrong chain");
    const reads = kit.exit.factsReads;
    kit.emit({ type: "checkpoint", seq: 200 });
    await kit.timers.pass(SLOW_READ_MS * 2);
    expect(kit.exit.factsReads).toBe(reads + 1);
  });

  it("reads what the vault holds again by itself once the exit has started", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(100, { exitStartedAt: 5_000, chainNow: 6_000 });
    kit.exit.claimsError = new Error("the wallet's RPC failed");
    await kit.store.exit.refresh();
    expect(kit.store.getSnapshot().exit.claimsProblem).toMatch(/RPC failed/);
    kit.exit.claimsError = null;
    await kit.timers.pass(wait(0));
    expect(kit.store.getSnapshot().exit.claimsProblem).toBeNull();
    expect(kit.store.getSnapshot().exit.claims).not.toBeNull();
  });
});
