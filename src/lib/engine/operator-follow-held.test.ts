/** Tests for what a follower with no wallet does while a drop at a turn boundary is held as a change of server (monkey-trading/console#496). */

import { describe, expect, it } from "vitest";

import type { EngineClient } from "./client";
import { B, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { settle } from "./test-kit";

const A_MEMBER = "0x00000000000000000000000000000000000000a1";
const B_MEMBER = "0x00000000000000000000000000000000000000b2";

describe("a drop held at a boundary with no wallet", () => {
  it("tries the member the heard turns name at once, though the stopped server's read never finishes", async () => {
    const successor = new TrialClient();
    successor.verdict = VERIFIED;
    const kit = rig({ reads: null, clients: { [B]: successor } });
    const boundary = 1_000_000 + 60_000;
    kit.trial.signedRead = async () => ({ turn: { candidate: A_MEMBER, applies_at: 1_000_000 - 60_000 }, next_turn: { candidate: B_MEMBER, applies_at: boundary }, rotation_enabled: true });
    kit.trial.operatorList = async () => ({ candidates: [{ address: A_MEMBER, api_hostname: "build.example" }, { address: B_MEMBER, api_hostname: "b.example" }] });
    kit.follower.watch(kit.trial as unknown as EngineClient); // the follower uses only what TrialClient has
    kit.follower.start(() => false);
    await kit.follower.check(); // the turns and each member's hostname are heard
    kit.advance(60_000 + 1_000); // past the boundary
    kit.trial.signedRead = () => new Promise(() => undefined); // the stopped server stalls rather than refusing
    for (const watcher of kit.trial.watchers) watcher({ type: "feed", status: "stale" });
    await settle();
    expect(kit.adopted).toEqual([B]);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: B });
  });
});
