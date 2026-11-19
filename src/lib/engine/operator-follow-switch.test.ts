/** Tests for a change of server already under way: an event that must not slow its retries, a wallet change that must not end it for a moment, and the turns of the node moved to. */

import { describe, expect, it } from "vitest";

import type { AttestationStatus } from "./attestation";
import type { EngineClient } from "./client";
import { SWITCH_RETRY_MS } from "./operator-follow";
import { B, named, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { settle } from "./test-kit";

const NOT_ANSWERING: AttestationStatus = { kind: "unverified", reason: "The server did not respond.", notReady: true };

describe("a change of server under way", () => {
  it("keeps a successor's quick retry when an event asks for a read at the slower pace", async () => {
    const successor = new TrialClient();
    successor.verdict = NOT_ANSWERING;
    const kit = rig({ clients: { [B]: successor } });
    kit.follower.watch(kit.trial as unknown as EngineClient); // the follower uses only what TrialClient has
    kit.follower.start(() => false);
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", stage: "connecting" });
    kit.advance(1_000);
    // A rotation event on the old stream, or a refusal, pokes within the gap between event-driven reads.
    kit.follower.poke();
    successor.verdict = VERIFIED;
    kit.advance(SWITCH_RETRY_MS - 1_000);
    await settle();
    expect(kit.adopted).toEqual([B]);
  });

  it("stays paused when a wallet change cuts a trial short, and lets the check run again for the new wallet decide", async () => {
    const successor = new TrialClient();
    let verified: (status: AttestationStatus) => void = () => undefined;
    successor.verify = () => new Promise((resolve) => { verified = resolve; });
    const kit = rig({ clients: { [B]: successor } });
    const kinds: string[] = [];
    kit.follower.subscribe(() => kinds.push(kit.follower.getSnapshot().kind));
    const checking = kit.follower.check();
    await settle();
    // The wallet changes while the trial runs: the store's change asks for a check, which joins the one running and runs again after it.
    kit.held.chain = { ...kit.reads };
    void kit.follower.check();
    successor.verify = async () => VERIFIED; // the check run again for the new wallet finds the successor ready
    verified(VERIFIED);
    await checking;
    await settle();
    // Paused from the first trial to the move, with no return to the node in use between.
    expect(kinds.slice(0, -1).every((kind) => kind === "waiting")).toBe(true);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: B });
    expect(kit.adopted).toEqual([B]);
  });

  it("reads again just after the next turn of the node moved to, not at the slow read", async () => {
    const successor = new TrialClient();
    successor.signedRead = async () => ({ next_turn: { candidate: "0x00000000000000000000000000000000000000c3", applies_at: 1_000_000 + 120_000 } });
    const kit = rig({ operator: async () => named(), clients: { [B]: successor } });
    kit.follower.start(() => false);
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
    kit.follower.watch(successor as unknown as EngineClient);
    kit.operatorReads.count = 0;
    kit.advance(120_000 + 5_000 - 1);
    await settle();
    expect(kit.operatorReads.count).toBe(0);
    kit.advance(1);
    await settle();
    expect(kit.operatorReads.count).toBe(1);
  });

  it("retries a successor within seconds while the read of the server being left hangs", async () => {
    const successor = new TrialClient();
    successor.verdict = NOT_ANSWERING;
    const kit = rig({ clients: { [B]: successor } });
    kit.trial.signedRead = () => new Promise(() => undefined); // the server being left neither answers nor refuses
    kit.follower.watch(kit.trial as unknown as EngineClient);
    kit.follower.start(() => false);
    void kit.follower.check();
    await settle();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", stage: "connecting" });
    successor.verdict = VERIFIED;
    kit.advance(SWITCH_RETRY_MS);
    await settle();
    expect(kit.adopted).toEqual([B]);
  });

  it("retries a successor within seconds with no wallet, and while the server being left re-verifies slowly, as with one", async () => {
    // No wallet: the node's own word named the successor before it went quiet.
    const noWallet = new TrialClient();
    noWallet.verdict = NOT_ANSWERING;
    const kit = rig({ reads: null, clients: { [B]: noWallet } });
    kit.trial.signedRead = async () => ({ api_hostname: { hostname: "b.example", block: 1, block_hash: "0x" }, rotation_enabled: true });
    kit.follower.watch(kit.trial as unknown as EngineClient);
    kit.follower.start(() => false);
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, stage: "connecting" });
    // The server being left still names B, which is tried once a check, not again for its word.
    const tries = noWallet.attestations;
    kit.advance(SWITCH_RETRY_MS);
    await settle();
    expect(noWallet.attestations - tries).toBe(1);
    kit.trial.signedRead = () => new Promise(() => undefined);
    noWallet.verdict = VERIFIED;
    kit.advance(2 * SWITCH_RETRY_MS);
    await settle();
    expect(kit.adopted).toEqual([B]);
    // A wallet: the server being left re-verifies against the vault and never finishes.
    const withWallet = new TrialClient();
    withWallet.verdict = NOT_ANSWERING;
    const walleted = rig({ clients: { [B]: withWallet } });
    walleted.follower.watch(walleted.trial as unknown as EngineClient);
    walleted.follower.start(() => false);
    await walleted.follower.check();
    walleted.trial.heedVault = () => new Promise(() => undefined);
    withWallet.verdict = VERIFIED;
    walleted.advance(SWITCH_RETRY_MS);
    await settle();
    expect(walleted.adopted).toEqual([B]);
  });

  it("explains a drop only once the stream is back for every watcher, so a pause can say trading resumed", async () => {
    const kit = rig({ operator: async () => named({ hostname: null }) });
    kit.follower.watch(kit.trial as unknown as EngineClient);
    await kit.follower.check();
    for (const watcher of kit.trial.watchers) watcher({ type: "feed", status: "stale" });
    expect(kit.follower.getSnapshot().kind).toBe("confirming");
    for (const watcher of kit.trial.watchers) watcher({ type: "feed", status: "live" });
    expect(kit.follower.getSnapshot().kind).toBe("confirming");
    await Promise.resolve();
    expect(kit.follower.getSnapshot().kind).not.toBe("confirming");
  });
});
