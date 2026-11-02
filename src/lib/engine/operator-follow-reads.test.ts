/** Tests for when the follower reads: reads cost the wallet's provider money, so nothing polls. */

import { describe, expect, it } from "vitest";

import type { ClientEvent, EngineClient } from "./client";
import { RETRY_MS, SLOW_READ_MS } from "./operator-follow";
import { B, named, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { settle } from "./test-kit";
import type { StreamMessage } from "./types";

describe("when the follower reads", () => {
  /** A rig started, its first read done. */
  async function started(options: Parameters<typeof rig>[0] = {}, hidden = () => false) {
    const kit = rig(options);
    kit.follower.start(hidden);
    await kit.follower.check();
    kit.operatorReads.count = 0;
    return kit;
  }

  it("reads every five minutes otherwise, and not a moment sooner", async () => {
    const { advance, operatorReads } = await started({ operator: async () => null });
    advance(SLOW_READ_MS - 1);
    await settle();
    expect(operatorReads.count).toBe(0);
    advance(1);
    await settle();
    expect(operatorReads.count).toBe(1);
  });

  it("skips the slow read in a hidden tab, and keeps its timer", async () => {
    let hidden = true;
    const { advance, operatorReads } = await started({ operator: async () => null }, () => hidden);
    advance(SLOW_READ_MS);
    await settle();
    expect(operatorReads.count).toBe(0);
    hidden = false;
    advance(SLOW_READ_MS);
    await settle();
    expect(operatorReads.count).toBe(1);
  });

  it("reads right after a pending election's effective time rather than wait for the slow read", async () => {
    const { advance, operatorReads } = await started({ operator: async () => named({ hostname: null, pending: { epoch: 1, candidate: "0xb", adminKey: "0xk", effectiveAtMs: 1_000_000 + 60_000, promoted: false } }) });
    advance(60_000 + 5_000 - 1);
    await settle();
    expect(operatorReads.count).toBe(0);
    advance(1);
    await settle();
    expect(operatorReads.count).toBe(1);
  });

  it("tries a target that has not verified again, waiting twice as long each time up to the slow read, and no longer once it holds", async () => {
    const kit = rig();
    kit.trial.verdict = { kind: "unverified", reason: "not yet" };
    kit.follower.start(() => false);
    await kit.follower.check();
    const waits: number[] = [];
    for (let wait = RETRY_MS; waits.length < 6; wait = Math.min(wait * 2, SLOW_READ_MS)) {
      const before = kit.operatorReads.count;
      kit.advance(wait - 1);
      await settle();
      expect(kit.operatorReads.count).toBe(before);
      kit.advance(1);
      await settle();
      expect(kit.operatorReads.count).toBe(before + 1);
      waits.push(wait);
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    kit.trial.verdict = VERIFIED;
    kit.advance(SLOW_READ_MS);
    await settle();
    expect(kit.adopted).toEqual([B]);
    expect(kit.operatorReads.count).toBe(8); // the first read, six retries, and the one that moved
    kit.advance(SLOW_READ_MS - 1);
    await settle();
    expect(kit.operatorReads.count).toBe(8);
  });

  it("still tries a target on its way in a hidden tab", async () => {
    const kit = rig();
    kit.trial.verdict = { kind: "unverified", reason: "not yet" };
    kit.follower.start(() => true);
    await kit.follower.check();
    kit.advance(RETRY_MS);
    await settle();
    expect(kit.trial.verifies).toBe(2);
  });

  it("stops reading once stopped", async () => {
    const kit = rig({ operator: async () => null });
    const stop = kit.follower.start(() => false);
    await kit.follower.check();
    stop();
    kit.operatorReads.count = 0;
    kit.advance(SLOW_READ_MS * 4);
    await settle();
    expect(kit.operatorReads.count).toBe(0);
  });
});

describe("a move of the vault's signer", () => {
  it("judges the node in use again, and a move of the release alone does not", async () => {
    let facts = { release: "0x1", signer: "0xa" };
    const kit = rig({ operator: async () => named({ rotationEnabled: false }) });
    kit.reads.vault = async () => facts;
    const inUse = new TrialClient();
    kit.follower.watch(inUse as unknown as EngineClient); // the follower uses only what TrialClient has
    await kit.follower.check();
    expect(inUse.verifies).toBe(0);
    facts = { release: "0x2", signer: "0xa" };
    await kit.follower.check();
    expect(inUse.verifies).toBe(0);
    facts = { release: "0x2", signer: "0xb" };
    await kit.follower.check();
    expect(inUse.verifies).toBe(1);
    await kit.follower.check();
    expect(inUse.verifies).toBe(1);
  });

  it("is followed from a build that names no registry too", async () => {
    let signer = "0xa";
    const kit = rig({ operator: async () => null });
    kit.reads.vault = async () => ({ release: "0x1", signer });
    const inUse = new TrialClient();
    kit.follower.watch(inUse as unknown as EngineClient); // the follower uses only what TrialClient has
    await kit.follower.check();
    signer = "0xb";
    await kit.follower.check();
    expect(inUse.verifies).toBe(1);
  });

  it("says so when the read fails, and keeps the node in use", async () => {
    const kit = rig({ operator: async () => named({ rotationEnabled: false }) });
    kit.reads.vault = async () => { throw new Error("no answer"); };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "failed", origin: "https://build.example", reason: "no answer" });
    expect(kit.adopted).toEqual([]);
  });
});

describe("what makes the follower read sooner", () => {
  const message = (type: string) => ({ offset: "1:0", type: "command", seq: 1, ts: 0, cmd: { type: "election" }, events: [{ type }] }) as unknown as StreamMessage;

  async function watched() {
    const kit = rig({ operator: async () => null });
    const client = new TrialClient();
    const stopWatch = kit.follower.watch(client as unknown as EngineClient); // the follower uses only what TrialClient has
    kit.follower.start(() => false);
    kit.advance(RETRY_MS);
    return { ...kit, client, stopWatch };
  }

  it("reads on an election or rotation event in the stream, and not on other events", async () => {
    for (const type of ["operator_elected", "rotation_switched"]) {
      const { client, operatorReads } = await watched();
      for (const subscriber of client.subscribers) subscriber(message(type));
      await settle();
      expect(operatorReads.count, type).toBe(1);
    }
    const { client, operatorReads } = await watched();
    for (const subscriber of client.subscribers) subscriber(message("fill"));
    await settle();
    expect(operatorReads.count).toBe(0);
  });

  it("reads when the feed goes stale, the enclave changes or the attestation fails, and not when the feed is live", async () => {
    const reading: ClientEvent[] = [{ type: "feed", status: "stale" }, { type: "enclave" }, { type: "attestation", status: { kind: "unverified", reason: "x" } }];
    for (const event of reading) {
      const { client, operatorReads } = await watched();
      for (const watcher of client.watchers) watcher(event);
      await settle();
      expect(operatorReads.count, event.type).toBe(1);
    }
    const { client, operatorReads } = await watched();
    for (const watcher of client.watchers) watcher({ type: "feed", status: "live" });
    await settle();
    expect(operatorReads.count).toBe(0);
  });

  it("does not read twice inside the gap however often the feed flaps, but reads once the gap has passed", async () => {
    const { client, operatorReads, advance } = await watched();
    const flap = () => { for (const watcher of client.watchers) watcher({ type: "feed", status: "stale" }); };
    flap();
    await settle();
    flap();
    flap();
    await settle();
    expect(operatorReads.count).toBe(1);
    advance(RETRY_MS);
    await settle();
    expect(operatorReads.count).toBe(2);
  });

  it("hears nothing from a client it stopped watching", async () => {
    const { client, stopWatch, operatorReads } = await watched();
    stopWatch();
    expect(client.watchers.size + client.subscribers.size).toBe(0);
    expect(operatorReads.count).toBe(0);
  });
});
