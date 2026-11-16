/** Tests for the signer floor with no wallet (monkey-trading/console#373, #374, #377): every signer a client's signed routes named holds every node moved to, and the node in use, to it. */

import { describe, expect, it } from "vitest";

import { EngineError, type EngineClient } from "./client";
import { B, named, rig, TrialClient } from "./operator-follow-kit";
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
const silent = async (): Promise<never> => { throw new EngineError(0, "The server didn't respond."); };
const LAGS = { kind: "waiting", target: C, reason: expect.stringContaining("newer signing key") };

/** A follower with no wallet over the node in use, whose route names `hostname` under epoch 5's key, and the listed nodes B and C. */
function visit(hostname: string) {
  const clients = { [B]: new TrialClient(), [C]: new TrialClient() };
  const kit = rig({ reads: null, clients });
  const current = new TrialClient();
  current.signedRead = async () => route(hostname, { epoch: 5, address: KA });
  const stopCurrent = kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
  return { ...kit, current, stopCurrent, nodeB: clients[B], nodeC: clients[C] };
}

/** A follower with a wallet whose chain names B, over a node in use whose route names nothing. */
function walletVisit() {
  const kit = rig();
  const current = new TrialClient();
  kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
  return { ...kit, current, nodeB: kit.trial };
}

describe("the signer floor a visit holds each node to (monkey-trading/console#373)", () => {
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

  it("takes no node at an epoch two nodes named different keys at, and puts the second word to the node in use", async () => {
    const kit = visit("b.example");
    kit.current.signedRead = async () => route("b.example", { epoch: 7, address: KA });
    await kit.follower.check(); // B states no signer yet, so the floor is the node in use's word
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B });
    kit.nodeB.signedRead = async () => route(null, { epoch: 7, address: KB });
    await kit.follower.check();
    expect(kit.adopted).toEqual([]);
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, reason: expect.stringContaining("newer signing key") });
    expect(kit.current.heard).toEqual([{ epoch: 7, address: KB }]);
  });

  it("holds a node moved to with a wallet to it too", async () => {
    const kit = walletVisit();
    kit.current.signedRead = async () => route(null, { epoch: 8, address: KA });
    // B verifies against the wallet's read, while its own word is older than the node in use's.
    kit.nodeB.signedRead = async () => route(null, { epoch: 7, address: KB });
    await kit.follower.check();
    expect(kit.adopted).toEqual([]);
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, reason: expect.stringContaining("newer signing key") });
  });

  it("holds a node it moves to with a wallet, whose route states no signer, to the floor, and no node it leaves waiting (monkey-trading/console#376)", async () => {
    const kit = walletVisit();
    kit.current.signedRead = async () => route(null, { epoch: 8, address: KA });
    kit.nodeB.verdict = { kind: "verified", release: "r", config: "c", address: KB };
    kit.nodeB.signedRead = async () => ({ ...ROUTE });
    // A wallet request in progress holds the move back.
    kit.held.busy = true;
    await kit.follower.check();
    expect([kit.adopted, kit.nodeB.held]).toEqual([[], []]);
    kit.held.busy = false;
    await kit.follower.check();
    expect([kit.adopted, kit.nodeB.held]).toEqual([[B], [{ epoch: 8, address: KA }]]);
  });

  it("holds a node it moves to with a wallet to both keys two nodes named at the floor's epoch, in either order (monkey-trading/console#381)", async () => {
    for (const [first, second] of [[KA, KB], [KB, KA]] as const) {
      const clients = { [B]: new TrialClient(), [C]: new TrialClient() };
      const kit = rig({ clients, operator: async () => named({ hostname: "c.example:8443" }) });
      const current = new TrialClient();
      current.signedRead = async () => route(null, { epoch: 8, address: first });
      kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
      // The chain names C, whose check reads its word naming the other key at that epoch, and leaves it waiting.
      clients[C].verify = async () => { clients[C].naming.judge(null, { signer: { epoch: 8, address: second } }); return { kind: "unverified", reason: "still taking the keys" }; };
      await kit.follower.check();
      // Then B, whose route states no signer and whose enclave the wallet's read of the vault judged.
      kit.setOperator(async () => named());
      clients[B].signedRead = async () => ({ ...ROUTE });
      await kit.follower.check();
      expect([kit.adopted, clients[B].held, clients[B].signerNamed()], first).toEqual([[B], [{ epoch: 8, address: null }], { epoch: 8, address: null }]);
    }
  });

  it("takes a node whose route states no signer when the wallet's read of the vault judged it, and only then", async () => {
    for (const verdict of [{ kind: "verified", release: "r", config: "c", address: KB }, { kind: "mock" }] as const) {
      const kit = walletVisit();
      kit.current.signedRead = async () => route(null, { epoch: 8, address: KA });
      kit.nodeB.verdict = verdict;
      kit.nodeB.signedRead = async () => ({ ...ROUTE });
      await kit.follower.check();
      expect(kit.adopted, verdict.kind).toEqual(verdict.kind === "verified" ? [B] : []);
    }
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

  it("puts to the node in use what each read of a trial named as that read ends, before the next one settles", async () => {
    const pending = (): Promise<never> => new Promise(() => {});
    for (const step of ["check, then its signed answer", "refused check, then its route read again", "a wallet's check, then the next"] as const) {
      const kit = step === "a wallet's check, then the next" ? walletVisit() : visit("b.example");
      const trial = kit.nodeB;
      const names = (address: string) => { trial.naming.judge(null, { signer: { epoch: 8, address } }); };
      if (step === "check, then its signed answer") trial.verify = async () => { names(KB); return trial.verdict; };
      if (step === "refused check, then its route read again") trial.verify = async () => { names(KC); return { kind: "unverified", reason: "The vault names another signer" }; };
      if (step === "a wallet's check, then the next") {
        trial.readChainThrough = async () => { names(KB); };
        trial.verify = pending;
      }
      trial.signedRead = pending;
      void kit.follower.check();
      await settle();
      expect(kit.current.heard, step).toEqual([{ epoch: 8, address: step === "refused check, then its route read again" ? KC : KB }]);
    }
  });

  it("puts to the node in use, with a wallet too, what the check of a node left waiting read", async () => {
    const kit = walletVisit();
    // The wallet's read of the vault fails for B, which its own word names at epoch 8.
    kit.nodeB.verify = async () => { kit.nodeB.naming.judge(null, { signer: { epoch: 8, address: KB } }); return { kind: "attested", release: "r", address: KB, why: "the vault could not be read" }; };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B });
    expect(kit.current.heard).toEqual([{ epoch: 8, address: KB }]);
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

describe("two keys a trial's own word named at one epoch (monkey-trading/console#381)", () => {
  it("puts them to the node in use, which then refuses the key it held at that epoch", async () => {
    const kit = visit("b.example");
    let says = KA;
    kit.nodeB.verify = async () => { kit.nodeB.naming.judge(null, { signer: { epoch: 8, address: says } }); return { kind: "unverified", reason: "still taking the keys" }; };
    await kit.follower.check();
    // B's enclave restarts, and its next check names another key at that epoch.
    says = KB;
    await kit.follower.check();
    expect([kit.current.heard, kit.current.naming.refuses(KA)]).toEqual([[{ epoch: 8, address: KA }, { epoch: 8, address: null }], true]);
  });
});

describe("a read that ends after the follower stopped waiting on its client (monkey-trading/console#377)", () => {
  /** A read of `client`'s route that ends when the test lands it. */
  function slowRead(client: TrialClient) {
    let land: (answer: unknown) => void = () => {};
    const before = client.signedRead;
    client.signedRead = () => new Promise((resolve) => { land = resolve; });
    const read = client.stats.operator();
    client.signedRead = before;
    return { read, land: (answer: unknown) => land(answer) };
  }

  it("raises the floor from the node moved away from, and puts it to the node moved to at once", async () => {
    const kit = visit("b.example");
    kit.nodeB.signedRead = async () => route(null, { epoch: 8, address: KB });
    // Another read of the node in use's word, as a page makes, is slow to come while B is tried.
    const late = slowRead(kit.current);
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
    // As the provider does once the move lands.
    kit.stopCurrent();
    kit.follower.watch(kit.nodeB as unknown as EngineClient); // the follower uses only what TrialClient has
    late.land(route(null, { epoch: 9, address: KC }));
    await late.read;
    expect(kit.nodeB.heard).toEqual([{ epoch: 9, address: KC }]);
  });

  it("raises the floor from a node tried and left waiting, and puts it to the node in use at once", async () => {
    const kit = visit("b.example");
    kit.nodeB.verdict = { kind: "unverified", reason: "still taking the keys" };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B });
    expect(kit.current.heard).toEqual([]);
    // B checks itself again, as a wallet's late read of the vault has it do, and its word names a later signer.
    const late = slowRead(kit.nodeB);
    late.land(route(null, { epoch: 9, address: KC }));
    await late.read;
    expect(kit.current.heard).toEqual([{ epoch: 9, address: KC }]);
  });
});
