/** Tests for the signer floor with no wallet (monkey-trading/console#373, #374): every signer a client's signed routes named holds every node moved to, and the node in use, to it. */

import { describe, expect, it } from "vitest";

import { EngineError, type EngineClient } from "./client";
import { B, rig, TrialClient } from "./operator-follow-kit";
import type { NamedSigner } from "./signer-naming";
import { settle } from "./test-kit";
import { RefusedAnswer } from "./trust-errors";

const C = "https://c.example:8443";
const KA = "0x00000000000000000000000000000000000000a1";
const KB = "0x00000000000000000000000000000000000000b1";
const KC = "0x00000000000000000000000000000000000000c1";
/** The fields every operator route carries. */
const ROUTE = { operator: KA, pending_rotation: null, rotation_enabled: true, last_election: null };
/** A route that says the registry names `hostname` and the vault names `signer`. */
const route = (hostname: string | null, signer: NamedSigner) => ({ ...ROUTE, ...(hostname === null ? {} : { api_hostname: { hostname, block: 1, block_hash: "0x" } }), signer });
const silent = async (): Promise<never> => { throw new EngineError(0, "The node did not answer."); };
const LAGS = { kind: "waiting", target: C, reason: expect.stringContaining("newer signer") };

/** A follower with no wallet over the node in use, whose route names `hostname` under epoch 5's key, and the listed nodes B and C. */
function visit(hostname: string) {
  const clients = { [B]: new TrialClient(), [C]: new TrialClient() };
  const kit = rig({ reads: null, clients });
  const current = new TrialClient();
  current.signedRead = async () => route(hostname, { epoch: 5, address: KA });
  kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
  return { ...kit, current, nodeB: clients[B], nodeC: clients[C] };
}

describe("the signer floor a visit with no wallet holds each node to (monkey-trading/console#373)", () => {
  it("does not take an older signer at another node once the node it moved to, which named a later one, stops answering", async () => {
    const kit = visit("build.example");
    // The node in use's schedule leads through B now to C a minute on.
    kit.current.signedRead = async () => ({ ...route("build.example", { epoch: 5, address: KA }), turn: { candidate: KB, applies_at: 0 }, next_turn: { candidate: KC, applies_at: 1_060_000 } });
    kit.current.operatorList = async () => ({ candidates: [{ address: KB, api_hostname: "b.example" }, { address: KC, api_hostname: "c.example:8443" }] });
    kit.nodeB.signedRead = async () => route(null, { epoch: 8, address: KB });
    kit.nodeC.signedRead = async () => route(null, { epoch: 7, address: KC });
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
    kit.follower.watch(kit.nodeB as unknown as EngineClient); // as the provider does once the move lands
    kit.nodeB.signedRead = silent;
    kit.advance(61_000);
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
    expect(kit.follower.getSnapshot()).toMatchObject(LAGS);
  });

  it("counts the route it reads from a node that failed its check but answered, and the word a node's check read before it stopped answering", async () => {
    for (const read of ["refusedRoute", "check"] as const) {
      const kit = visit("b.example");
      if (read === "refusedRoute") {
        kit.nodeB.verdict = { kind: "unverified", reason: "the quote did not verify" };
        kit.nodeB.signedRead = async () => route(null, { epoch: 8, address: KB });
      } else {
        kit.nodeB.verify = async () => { kit.nodeB.naming.judge(null, { signer: { epoch: 8, address: KB } }); return kit.nodeB.verdict; };
        kit.nodeB.signedRead = silent;
      }
      await kit.follower.check();
      expect(kit.follower.getSnapshot(), read).toMatchObject({ kind: "waiting", target: B });
      // The registry moves on to C, whose word is older than B's.
      kit.current.signedRead = async () => route("c.example:8443", { epoch: 5, address: KA });
      kit.nodeC.signedRead = async () => route(null, { epoch: 7, address: KC });
      await kit.follower.check();
      expect(kit.adopted, read).toEqual([]);
      expect(kit.follower.getSnapshot(), read).toMatchObject(LAGS);
    }
  });

  it("counts what a node tried for a wallet that left during its check named, once the visit has no wallet", async () => {
    const nodeC = new TrialClient();
    nodeC.signedRead = async () => route(null, { epoch: 7, address: KC });
    const kit = rig({ clients: { [C]: nodeC } });
    const current = new TrialClient();
    current.signedRead = async () => route("c.example:8443", { epoch: 5, address: KA });
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    // The chain names B, whose signed answer comes after the wallet has gone.
    kit.trial.signedRead = async () => { kit.held.chain = null; return route(null, { epoch: 8, address: KB }); };
    await kit.follower.check();
    expect(kit.adopted).toEqual([]);
    await kit.follower.check();
    expect(kit.adopted).toEqual([]);
    expect(kit.follower.getSnapshot()).toMatchObject(LAGS);
  });

  it("counts what another of the page's reads of the node in use named before it stopped answering", async () => {
    const kit = visit("c.example:8443");
    kit.nodeC.verdict = { kind: "unverified", reason: "still taking the keys" };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: C });
    // The Staking page reads the node in use's route, which now names its own key at epoch 8; then it stops.
    kit.current.signedRead = async () => route("c.example:8443", { epoch: 8, address: KA });
    await kit.current.stats.operator();
    kit.current.signedRead = silent;
    kit.nodeC.verdict = { kind: "verified", release: "r", config: "c", address: KC };
    kit.nodeC.signedRead = async () => route(null, { epoch: 7, address: KC });
    await kit.follower.check();
    expect(kit.adopted).toEqual([]);
    expect(kit.follower.getSnapshot()).toMatchObject(LAGS);
  });
});

describe("the node in use under a later signer another node names (monkey-trading/console#374)", () => {
  /** The node in use names B, which is refused and whose signed route names C's key at epoch 7. */
  function refusedB() {
    const kit = visit("b.example");
    kit.nodeB.verdict = { kind: "unverified", reason: "The vault names another signer" };
    kit.nodeB.signedRead = async () => { throw new RefusedAnswer("The vault names another signer", route("c.example:8443", { epoch: 7, address: KC })); };
    return kit;
  }

  it("puts the floor to the node in use as it rises, while the successor stays unavailable, and only as it rises", async () => {
    const kit = refusedB();
    kit.nodeC.verify = silent;
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: C });
    expect(kit.current.heard).toEqual([{ epoch: 7, address: KC }]);
    await kit.follower.check();
    expect(kit.current.heard).toEqual([{ epoch: 7, address: KC }]);
  });

  it("puts to the node in use, with a wallet too, what the check of a node left waiting read", async () => {
    const kit = rig();
    const current = new TrialClient();
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    // The wallet's read of the vault fails for the trial, which its own word names at epoch 8.
    kit.trial.verify = async () => { kit.trial.naming.judge(null, { signer: { epoch: 8, address: KB } }); return { kind: "attested", release: "r", address: KB, why: "the vault could not be read" }; };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B });
    expect(current.heard).toEqual([{ epoch: 8, address: KB }]);
  });

  it("reads the node it moved to on the check the old node's refusal starts, not the old node", async () => {
    const kit = refusedB();
    kit.nodeC.signedRead = async () => route(null, { epoch: 7, address: KC });
    // As a live client does, the node in use loses its verdict on a key it is not, and says so.
    kit.current.heedSigner = (signer) => {
      kit.current.heard.push(signer);
      kit.current.signedRead = async () => { throw new RefusedAnswer("The vault names another signer", route("b.example", { epoch: 5, address: KA })); };
      for (const watcher of kit.current.watchers) watcher({ type: "attestation", status: { kind: "unverified", reason: "The vault names another signer" } });
    };
    await kit.follower.check();
    await settle();
    expect(kit.adopted).toEqual([C]);
    expect(kit.current.heard).toEqual([{ epoch: 7, address: KC }]);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "pinned", origin: C });
  });
});
