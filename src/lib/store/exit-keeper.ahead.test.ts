import { beforeEach, describe, expect, it } from "vitest";

import { ACCOUNT, emptyProof, factsAt, fullProof } from "../engine/exit-kit";
import type { VaultExitFacts } from "../engine/exit-types";
import { settle } from "../engine/test-kit";
import { CHASE_MS } from "./exit";
import { exitView } from "./exit-view";
import { exitWatchKit } from "./exit-watch-kit";

describe("ExitKeeper, with the node's answer ahead of the vault", () => {
  let kit: ReturnType<typeof exitWatchKit>;
  const exit = () => kit.store.getSnapshot().exit;
  beforeEach(() => {
    kit = exitWatchKit();
    kit.exit.vault = factsAt(100);
    kit.client.exitAnswer = fullProof(200);
  });

  it("saves it, checked, when the vault reaches its seq, with no further node read", async () => {
    await kit.connect();
    expect(exit().record).toBeNull();
    expect(kit.exit.checks).toEqual([]);
    kit.exit.vault = factsAt(200);
    await kit.store.exit.refresh();
    expect(exit().record?.proof.seq).toBe(200);
    expect(exit().checked).toBe(exit().record);
    expect(exit().attempt).toBeNull();
    expect(kit.exit.checks.length).toBe(1);
    expect(kit.client.exitReads).toBe(1);
  });
  it("waits while the vault moves but has not reached it, asking neither the node nor the wallet more", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(150);
    const facts = kit.exit.factsReads;
    await kit.store.exit.refresh();
    expect(kit.client.exitReads).toBe(1);
    expect(kit.exit.factsReads).toBe(facts + 1); // that read alone
    expect(kit.exit.checks).toEqual([]);
    expect(exit().attempt).toEqual({ kind: "node-ahead", nodeSeq: 200 });
  });
  it("drops it once the vault has passed it, which no claim could use, and asks for the next, which replaces it", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(300);
    kit.client.exitAnswer = fullProof(400);
    const facts = kit.exit.factsReads;
    await kit.store.exit.refresh();
    expect(kit.client.exitReads).toBe(2);
    expect(kit.exit.factsReads).toBe(facts + 2); // that read and the new answer's own, with none for the answer the vault has passed
    expect(exit().attempt).toEqual({ kind: "node-ahead", nodeSeq: 400 });
    kit.exit.vault = factsAt(400);
    await kit.store.exit.refresh();
    expect(exit().record?.proof.seq).toBe(400);
    expect(kit.client.exitReads).toBe(2);
  });
  it("is saved though the node has gone by then", async () => {
    await kit.connect();
    kit.client.exitError = new Error("the node is gone");
    kit.store.patch({ attestation: { kind: "unverified", reason: "The node did not answer." }, stream: "stale" });
    await settle();
    kit.exit.vault = factsAt(200);
    await kit.store.exit.refresh();
    expect(exit().record?.proof.seq).toBe(200);
  });
  it("reads the vault soon, with no checkpoint from the stream to chase", async () => {
    await kit.connect();
    kit.exit.vault = factsAt(200);
    await kit.timers.pass(CHASE_MS[0] ?? 0);
    expect(exit().record?.proof.seq).toBe(200);
  });
  it("leaves a checkpoint's chase under way to its own pace", async () => {
    kit.client.exitAnswer = fullProof(100);
    await kit.connect();
    kit.emit({ type: "checkpoint", seq: 200 } as never);
    const first = CHASE_MS[0] ?? 0;
    await kit.timers.pass(first - 1_000);
    kit.exit.vault = factsAt(150);
    kit.client.exitAnswer = fullProof(200);
    await kit.store.exit.refresh();
    expect(exit().attempt).toEqual({ kind: "node-ahead", nodeSeq: 200 });
    const facts = kit.exit.factsReads;
    await kit.timers.pass(1_000);
    expect(kit.exit.factsReads).toBe(facts + 1);
  });
  it("is not read again for what it has already answered, when it comes back from away", async () => {
    await kit.connect();
    kit.store.patch({ stream: "stale" });
    await settle();
    kit.store.patch({ stream: "live" });
    await settle();
    expect(kit.client.exitReads).toBe(1);
  });
  it("leaves a staker's line alone through each read of the node, so nothing flips", async () => {
    kit.exit.staked = true;
    kit.exit.vault = factsAt(100);
    kit.client.exitAnswer = emptyProof(100);
    await kit.connect(0n);
    expect(exit().nothing).toBe(true);
    const seen: boolean[] = [];
    kit.store.subscribe(() => seen.push(exit().nothing));
    kit.exit.vault = factsAt(200);
    kit.client.exitAnswer = emptyProof(200);
    await kit.store.exit.refresh();
    expect(kit.client.exitReads).toBe(2);
    expect(seen).not.toContain(false);
  });
});

describe("the exit proof at a fast cadence, with the wallet's read behind the node", () => {
  const CADENCE_MS = 13_000;
  const POST_AFTER_MS = 6_000;
  const WALLET_BEHIND_MS = 5_000;
  const CHECKPOINTS = 15;
  /** Lets the node sign a checkpoint every 13 s, the vault take it 6 s later, and the wallet see that 5 s after that; returns what the panel said at each store change. */
  async function run(kit: ReturnType<typeof exitWatchKit>) {
    const posts: { at: number; facts: VaultExitFacts }[] = [];
    const facts = (now: number): VaultExitFacts => {
      const seen = posts.findLast((post) => post.at + WALLET_BEHIND_MS <= now) ?? posts[0];
      if (seen === undefined) throw new Error("the vault has a first checkpoint");
      return { ...seen.facts, chainNow: 1_000 + Math.floor(now / 1000) };
    };
    const seqAt = (index: number) => 1_000 * (index + 1);
    const post = (index: number) => posts.push({ at: kit.timers.now, facts: factsAt(seqAt(index), { lastCheckpointAt: 1_000 + Math.floor(kit.timers.now / 1000) }) });
    post(0);
    kit.exit.facts = async () => { kit.exit.factsReads += 1; return facts(kit.timers.now); };
    kit.client.exitAnswer = fullProof(seqAt(1));
    const said: { lines: string[]; tones: string[]; notice: string | null }[] = [];
    const listen = () => {
      const view = exitView(kit.store.getSnapshot().exit, { address: ACCOUNT });
      said.push({ lines: view.lines.map((line) => line.text), tones: view.lines.map((line) => line.tone), notice: view.notice?.text ?? null });
    };
    kit.store.subscribe(listen);
    await kit.connect();
    for (let index = 1; index <= CHECKPOINTS; index += 1) {
      kit.client.exitAnswer = fullProof(seqAt(index + 1));
      kit.emit({ type: "checkpoint", seq: seqAt(index) } as never);
      await kit.timers.pass(POST_AFTER_MS);
      post(index);
      await kit.timers.pass(CADENCE_MS - POST_AFTER_MS);
    }
    return { said, finalSeq: seqAt(CHECKPOINTS) };
  }
  /** A line with its figures out, as what it says is what must not flip. */
  const shape = (line: string) => line.replace(/checkpoint [\d,]*\d/g, "checkpoint N").replace(/posted .*? ago/g, "posted a while ago");

  it("stays calm, saying one thing, keeps up, and reads the node no more than once a checkpoint", async () => {
    const kit = exitWatchKit();
    const { said, finalSeq } = await run(kit);
    expect(said.flatMap((entry) => entry.tones).every((tone) => tone === "calm")).toBe(true);
    expect(said.filter((entry) => entry.notice !== null)).toEqual([]);
    expect(said.flatMap((entry) => entry.lines).filter((line) => /refuse|does not hold/.test(line))).toEqual([]);
    const shapes = new Set(said.filter((entry) => entry.lines.some((line) => line.startsWith("Saved"))).flatMap((entry) => entry.lines).map(shape));
    expect([...shapes]).toEqual(["Saved in this browser: checkpoint N, posted a while ago. It proves 5,083 USDC, and a deposit still pending."]);
    const saved = kit.store.getSnapshot().exit.record?.proof.seq ?? 0;
    expect(saved).toBeGreaterThanOrEqual(finalSeq - 2_000);
    expect(kit.client.exitReads).toBeLessThanOrEqual(CHECKPOINTS + 1);
    expect(kit.exit.checks.length).toBeGreaterThanOrEqual(CHECKPOINTS / 2);
  });
});
