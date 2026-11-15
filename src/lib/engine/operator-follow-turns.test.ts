/** Tests for when the follower reads around the node's own daily turns (monkey-trading/console#280): a read just after each turn begins, and what it does with no wallet. */

import { describe, expect, it } from "vitest";

import type { EngineClient } from "./client";
import { SLOW_READ_MS } from "./operator-follow";
import { B, named, rig } from "./operator-follow-kit";
import { settle } from "./test-kit";

describe("the follower and the node's turns", () => {
  it("reads right after the node's next daily turn begins, with no election pending, rather than wait for the slow read", async () => {
    const kit = rig({ operator: async () => named({ hostname: null }) });
    kit.trial.signedRead = async () => ({ next_turn: { applies_at: 1_000_000 + 90_000 } });
    kit.follower.watch(kit.trial as unknown as EngineClient); // the follower uses only what TrialClient has
    kit.follower.start(() => false);
    await kit.follower.check();
    kit.operatorReads.count = 0;
    kit.advance(90_000 + 5_000 - 1);
    await settle();
    expect(kit.operatorReads.count).toBe(0);
    kit.advance(1);
    await settle();
    expect(kit.operatorReads.count).toBe(1);
  });

  it("moves to the next member's node when the turn begins: the read just after it finds the chain naming another hostname, which verifies", async () => {
    const kit = rig({ operator: async () => named({ hostname: null }) });
    kit.trial.signedRead = async () => ({ next_turn: { applies_at: 1_000_000 + 90_000 } });
    kit.follower.watch(kit.trial as unknown as EngineClient); // the follower uses only what TrialClient has
    kit.follower.start(() => false);
    await kit.follower.check();
    expect(kit.adopted).toEqual([]);
    // The chain names the next member from the boundary; the follower reads once it has begun, and nothing sooner.
    kit.setOperator(async () => named({ hostname: "b.example" }));
    kit.advance(90_000 + 5_000 - 1);
    await settle();
    expect(kit.adopted).toEqual([]);
    kit.advance(1);
    await settle();
    expect(kit.adopted).toEqual([B]);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: B });
  });

  it("reads the node's turn with no wallet to read a chain, and does not wait on a node that stalls before it reads the chain", async () => {
    const withoutWallet = rig({ reads: null });
    withoutWallet.trial.signedRead = async () => ({ next_turn: { applies_at: 1_000_000 + 90_000 } });
    withoutWallet.follower.watch(withoutWallet.trial as unknown as EngineClient);
    withoutWallet.follower.start(() => false);
    await withoutWallet.follower.check();
    expect(withoutWallet.follower.getSnapshot().kind).toBe("pinned");
    const stalled = rig({ operator: async () => named({ hostname: null }) });
    stalled.trial.signedRead = () => new Promise(() => undefined);
    stalled.follower.watch(stalled.trial as unknown as EngineClient);
    stalled.follower.start(() => false);
    void stalled.follower.check();
    await settle();
    expect(stalled.follower.getSnapshot().kind).toBe("following");
  });

  it("ignores a turn that is already past, a node that cannot answer, and one that names no next turn", async () => {
    for (const read of [async () => ({ next_turn: { applies_at: 1_000_000 - 1 } }), async () => { throw new Error("down"); }, async () => ({})]) {
      const kit = rig({ operator: async () => named({ hostname: null }) });
      kit.trial.signedRead = read;
      kit.follower.watch(kit.trial as unknown as EngineClient);
      kit.follower.start(() => false);
      await kit.follower.check();
      kit.operatorReads.count = 0;
      kit.advance(SLOW_READ_MS - 1);
      await settle();
      expect(kit.operatorReads.count).toBe(0);
    }
  });
});
