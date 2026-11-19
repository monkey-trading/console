/** Tests for what the follower does when the stream of the node in use drops: a handover takes that node's API down, so the drop is read as a move before it is called an outage. */

import { describe, expect, it } from "vitest";

import type { AttestationStatus } from "./attestation";
import type { EngineClient } from "./client";
import { RETRY_MS, SLOW_READ_MS, SWITCH_RETRY_MS } from "./operator-follow";
import { B, BUILD, named, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { settle } from "./test-kit";

/** The members of two turns on either side of a boundary, as the node's route names them. */
const A_MEMBER = "0x00000000000000000000000000000000000000a1";
const B_MEMBER = "0x00000000000000000000000000000000000000b2";

/** What a node that is not serving yet leaves its check with: it did not answer. */
const NOT_ANSWERING: AttestationStatus = { kind: "unverified", reason: "The server did not respond.", notReady: true };

/** The node in use, watched, and a successor at `B` whose verdict a test sets; the chain names the build's own node until a test moves it. */
async function handover() {
  const successor = new TrialClient();
  successor.verdict = NOT_ANSWERING;
  const kit = rig({ operator: async () => named({ hostname: null }), clients: { [B]: successor } });
  kit.follower.watch(kit.trial as unknown as EngineClient); // the follower uses only what TrialClient has
  kit.follower.start(() => false);
  await kit.follower.check();
  expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: BUILD });
  const drop = () => { for (const watcher of kit.trial.watchers) watcher({ type: "feed", status: "stale" }); };
  return { ...kit, successor, drop };
}

describe("a dropped stream", () => {
  it("is read at once, within the wait between event-driven reads, and is not called an outage until the read says the operator has not moved", async () => {
    const kit = await handover();
    kit.operatorReads.count = 0;
    kit.advance(1_000); // well within RETRY_MS of the last read
    kit.drop();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "confirming", origin: BUILD, scheduled: false });
    await settle();
    expect(kit.operatorReads.count).toBe(1);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: BUILD });
  });

  it("moves to the successor the chain names as soon as it answers, without waiting for the slow read", async () => {
    const kit = await handover();
    kit.setOperator(async () => named({ hostname: "b.example" }));
    kit.drop();
    await settle();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "waiting", origin: BUILD, target: B, stage: "connecting", reason: null });
    // The successor serves once it has taken the keys, moments after the node it replaces went down.
    kit.successor.verdict = VERIFIED;
    kit.advance(SWITCH_RETRY_MS - 1);
    await settle();
    expect(kit.adopted).toEqual([]);
    kit.advance(1);
    await settle();
    expect(kit.adopted).toEqual([B]);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: B });
  });

  it("tries a successor that has not answered again within seconds, waiting twice as long each time", async () => {
    const kit = await handover();
    kit.setOperator(async () => named({ hostname: "b.example" }));
    kit.drop();
    await settle();
    const tries = [kit.successor.attestations];
    for (const wait of [SWITCH_RETRY_MS, 2 * SWITCH_RETRY_MS, 4 * SWITCH_RETRY_MS]) {
      kit.advance(wait - 1);
      await settle();
      expect(kit.successor.attestations).toBe(tries.at(-1));
      kit.advance(1);
      await settle();
      tries.push(kit.successor.attestations);
    }
    expect(tries).toEqual([1, 2, 3, 4]);
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", stage: "connecting" });
  });

  it("refuses a successor that answers and fails its check, says why, stays off it and tries it again only at the slower pace", async () => {
    const kit = await handover();
    kit.setOperator(async () => named({ hostname: "b.example" }));
    kit.successor.verdict = { kind: "unverified", reason: "not the vault's release" };
    kit.drop();
    await settle();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "waiting", origin: BUILD, target: B, stage: "refused", reason: "not the vault's release" });
    kit.advance(RETRY_MS - 1);
    await settle();
    expect(kit.successor.verifies).toBe(1);
    expect(kit.adopted).toEqual([]);
    kit.advance(1);
    await settle();
    expect(kit.successor.verifies).toBe(2);
  });

  it("starts the quick retries afresh at the drop, the moment the successor is due to serve", async () => {
    const kit = await handover();
    kit.setOperator(async () => named({ hostname: "b.example" }));
    // A read just after the turn begins finds the successor not serving yet, and the waits grow.
    await kit.follower.check();
    kit.advance(SWITCH_RETRY_MS);
    await settle();
    kit.advance(1_000);
    expect(kit.successor.attestations).toBe(2);
    // The node in use then goes down as it hands over: the successor is read at once, and again within the first wait.
    kit.drop();
    await settle();
    expect(kit.successor.attestations).toBe(3);
    kit.successor.verdict = VERIFIED;
    kit.advance(SWITCH_RETRY_MS);
    await settle();
    expect(kit.adopted).toEqual([B]);
  });

  it("reads again soon while the node in use stays down and the chain still names it, rather than at the slow read", async () => {
    const kit = await handover();
    kit.drop();
    await settle();
    kit.operatorReads.count = 0;
    kit.advance(RETRY_MS);
    await settle();
    expect(kit.operatorReads.count).toBe(1);
    // A frame arrives again: the outage is over, and the pace is the slow read's.
    for (const watcher of kit.trial.watchers) watcher({ type: "feed", status: "live" });
    kit.advance(2 * RETRY_MS);
    await settle();
    kit.operatorReads.count = 0;
    kit.advance(SLOW_READ_MS - 1);
    await settle();
    expect(kit.operatorReads.count).toBe(0);
  });

  it("goes back to what it concluded before the drop when the check ends with no conclusion, such as when the wallet changed while it ran", async () => {
    const kit = await handover();
    let release: () => void = () => undefined;
    kit.setOperator(() => new Promise((resolve) => { release = () => resolve(named({ hostname: null })); }));
    kit.drop();
    await settle();
    expect(kit.follower.getSnapshot().kind).toBe("confirming");
    kit.held.chain = null; // the wallet disconnected while the chain read was out
    release();
    await settle();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: BUILD });
  });

  it("holds a drop at a turn boundary at which the member changes as a change of server, re-reading within seconds, until the chain names the successor", async () => {
    const kit = await handover();
    const boundary = 1_000_000 + 60_000;
    kit.trial.signedRead = async () => ({ turn: { candidate: A_MEMBER, applies_at: 1_000_000 - 60_000 }, next_turn: { candidate: B_MEMBER, applies_at: boundary } });
    await kit.follower.check();
    kit.advance(60_000 + 1_000); // the boundary has passed, and the turn's read just after it is due
    kit.drop();
    await settle();
    // The chain does not name the successor yet: no outage, and the read comes again within seconds.
    expect(kit.follower.getSnapshot()).toEqual({ kind: "confirming", origin: BUILD, scheduled: true });
    kit.operatorReads.count = 0;
    kit.advance(SWITCH_RETRY_MS);
    await settle();
    expect(kit.operatorReads.count).toBe(1);
    expect(kit.follower.getSnapshot().kind).toBe("confirming");
    kit.setOperator(async () => named({ hostname: "b.example" }));
    kit.successor.verdict = VERIFIED;
    kit.advance(2 * SWITCH_RETRY_MS);
    await settle();
    expect(kit.adopted).toEqual([B]);
  });

  it("calls a drop at a boundary an outage once the time a member may take to serve has passed with the operator unmoved", async () => {
    const kit = await handover();
    const boundary = 1_000_000 + 60_000;
    kit.trial.signedRead = async () => ({ turn: { candidate: A_MEMBER, applies_at: 1_000_000 - 60_000 }, next_turn: { candidate: B_MEMBER, applies_at: boundary } });
    await kit.follower.check();
    kit.advance(60_000 + 1_000);
    kit.drop();
    await settle();
    expect(kit.follower.getSnapshot().kind).toBe("confirming");
    // Half a turn of two minutes: a minute after the boundary.
    for (let waited = 0; waited < 60_000; waited += 5_000) {
      kit.advance(5_000);
      await settle();
    }
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: BUILD });
  });

  it("reads a drop at a boundary at once even when an earlier drop was read moments before", async () => {
    const kit = await handover();
    const boundary = 1_000_000 + 60_000;
    kit.trial.signedRead = async () => ({ turn: { candidate: A_MEMBER, applies_at: 1_000_000 - 60_000 }, next_turn: { candidate: B_MEMBER, applies_at: boundary } });
    await kit.follower.check();
    kit.advance(20_000); // a blip well before the boundary, read at once and found no move
    kit.drop();
    await settle();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: BUILD });
    for (const watcher of kit.trial.watchers) watcher({ type: "feed", status: "live" });
    kit.advance(15_000); // within the boundary's allowance, and within RETRY_MS of that read
    kit.setOperator(async () => named({ hostname: "b.example" }));
    kit.successor.verdict = VERIFIED;
    kit.drop();
    await settle();
    expect(kit.adopted).toEqual([B]);
  });
});
