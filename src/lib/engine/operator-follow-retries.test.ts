/** Tests for how soon the follower tries a chain read that failed again: sooner than the slow read, and only until one answers. */

import { describe, expect, it } from "vitest";

import { RETRY_MS, SLOW_READ_MS } from "./operator-follow";
import { B, named, rig } from "./operator-follow-kit";
import { settle } from "./test-kit";

describe("after a chain read that failed", () => {
  const failing = async () => { throw new Error("your wallet did not answer in time"); };

  it("tries again sooner than the slow read, waiting twice as long each time up to it, and at the slow pace once one answers", async () => {
    const kit = rig({ operator: failing });
    kit.follower.start(() => false);
    await kit.follower.check();
    expect(kit.follower.getSnapshot().kind).toBe("failed");
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
    kit.setOperator(async () => named({ hostname: null }));
    kit.advance(SLOW_READ_MS);
    await settle();
    expect(kit.follower.getSnapshot().kind).toBe("following");
    const answered = kit.operatorReads.count;
    kit.advance(SLOW_READ_MS - 1);
    await settle();
    expect(kit.operatorReads.count).toBe(answered);
    kit.advance(1);
    await settle();
    expect(kit.operatorReads.count).toBe(answered + 1);
  });

  it("takes the same waits when the vault's read is the one that failed", async () => {
    const kit = rig({ operator: async () => named({ hostname: null }) });
    kit.reads.vault = failing;
    kit.follower.start(() => false);
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "failed", reason: "your wallet did not answer in time" });
    const before = kit.operatorReads.count;
    kit.advance(RETRY_MS);
    await settle();
    expect(kit.operatorReads.count).toBe(before + 1);
  });

  it("moves to the successor at the first wait once a wallet that missed the bound answers, with the stale feed poking no more", async () => {
    const kit = rig({ operator: () => new Promise(() => {}) });
    kit.follower.start(() => false);
    const stuck = kit.follower.check();
    await settle();
    kit.advance(30_000);
    await stuck;
    expect(kit.follower.getSnapshot().kind).toBe("failed");
    kit.setOperator(async () => named());
    kit.advance(RETRY_MS);
    await settle();
    expect(kit.adopted).toEqual([B]);
  });

  it("skips those reads in a hidden tab, reads when it is seen again, and starts the waits over", async () => {
    let hidden = false;
    const kit = rig({ operator: failing });
    kit.follower.start(() => hidden);
    await kit.follower.check();
    hidden = true;
    const before = kit.operatorReads.count;
    kit.advance(RETRY_MS);
    await settle();
    kit.advance(SLOW_READ_MS * 3);
    await settle();
    expect(kit.operatorReads.count).toBe(before);
    hidden = false;
    kit.follower.resume();
    await settle();
    expect(kit.operatorReads.count).toBe(before + 1);
    kit.advance(RETRY_MS - 1);
    await settle();
    expect(kit.operatorReads.count).toBe(before + 1);
    kit.advance(1);
    await settle();
    expect(kit.operatorReads.count).toBe(before + 2);
  });
});
