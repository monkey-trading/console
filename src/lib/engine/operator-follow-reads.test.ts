/** Tests for when the follower reads: reads cost the wallet's provider money, so nothing polls. */

import { describe, expect, it } from "vitest";

import type { ClientEvent, EngineClient } from "./client";
import { RETRY_MS, SLOW_READ_MS } from "./operator-follow";
import { B, named, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import type { NamedOperator } from "./registry";
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

  it("slows down when an effective time has passed and the chain still answers that election, rather than read every 30 seconds", async () => {
    const pending = { epoch: 1, candidate: "0xb", adminKey: "0xk", effectiveAtMs: 1_000_000, promoted: false };
    const kit = rig({ operator: async () => named({ hostname: null, pending }) });
    kit.follower.start(() => false);
    await kit.follower.check();
    for (const wait of [30_000, 60_000, 120_000, 240_000, 300_000]) {
      const before = kit.operatorReads.count;
      kit.advance(wait - 1);
      await settle();
      expect(kit.operatorReads.count, String(wait)).toBe(before);
      kit.advance(1);
      await settle();
      expect(kit.operatorReads.count, String(wait)).toBe(before + 1);
    }
  });

  it("starts its waits again once nothing has been waiting", async () => {
    const pending = { epoch: 1, candidate: "0xb", adminKey: "0xk", effectiveAtMs: 1_000_000, promoted: false };
    const kit = rig({ operator: async () => named({ hostname: null, pending }) });
    kit.follower.start(() => false);
    await kit.follower.check();
    kit.advance(30_000); // the first wait, which doubles the next
    await settle();
    kit.setOperator(async () => named({ hostname: null }));
    kit.advance(60_000); // the election has gone: this read settles
    await settle();
    kit.advance(SLOW_READ_MS); // and the slow read takes it from there, which is what resets the waits
    await settle();
    kit.setOperator(async () => named({ hostname: null, pending }));
    kit.advance(SLOW_READ_MS);
    await settle();
    const before = kit.operatorReads.count;
    kit.advance(30_000);
    await settle();
    expect(kit.operatorReads.count).toBe(before + 1);
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

describe("what the vault says", () => {
  /** A rig watching a client in use, the vault answering `facts`. */
  function inUse(operator: () => Promise<NamedOperator | null>, facts = { release: "0x1", signer: "0xa" }) {
    const kit = rig({ operator });
    kit.reads.vault = async () => facts;
    const client = new TrialClient();
    kit.follower.watch(client as unknown as EngineClient); // the follower uses only what TrialClient has
    return { ...kit, client, facts };
  }

  it("reaches the client in use on every path, whatever comes of the operator's node", async () => {
    const paths: [string, () => Promise<NamedOperator | null>][] = [
      ["no registry", async () => null],
      ["the node in use is the operator's", async () => named({ hostname: null })],
      ["a hostname the build does not list", async () => named({ hostname: "evil.example" })],
      ["a move", async () => named()],
    ];
    for (const [path, operator] of paths) {
      const { follower, client, facts } = inUse(operator);
      await follower.check();
      expect(client.heeded, path).toEqual([facts]);
    }
    const waiting = inUse(async () => named());
    waiting.trial.verdict = { kind: "unverified", reason: "not yet" };
    await waiting.follower.check();
    expect(waiting.follower.getSnapshot().kind).toBe("waiting");
    expect(waiting.client.heeded).toEqual([waiting.facts]);
  });

  it("hears nothing from a wallet that left while it read", async () => {
    const kit = inUse(async () => named());
    const read = kit.reads.vault;
    kit.reads.vault = () => { kit.held.chain = null; return read(); };
    await kit.follower.check();
    expect(kit.client.heeded).toEqual([]);
    expect(kit.adopted).toEqual([]);
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
