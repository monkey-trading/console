/** Tests for a visit with no wallet to read a chain, and for a handover under way (monkey-trading/console#280). */

import { describe, expect, it } from "vitest";

import { EngineError, type EngineClient } from "./client";
import { B, BUILD, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { RefusedAnswer } from "./trust-errors";

/** The fields every operator route carries. */
const ROUTE = { operator: "0x00000000000000000000000000000000000000a1", pending_rotation: null, rotation_enabled: true, last_election: null };

describe("a visit with no wallet to read a chain (monkey-trading/console#280)", () => {
  /** A follower with no chain whose node in use says the registry names `hostname`. */
  function withoutWallet(hostname: string | null, rotationEnabled = true) {
    const kit = rig({ reads: null });
    const current = new TrialClient();
    current.signedRead = async () => ({ ...(hostname === null ? {} : { api_hostname: { hostname, block: 1, block_hash: "0x" } }), rotation_enabled: rotationEnabled });
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    return { ...kit, current };
  }

  it("moves to the node the registry names, from the node in use's own word, when the build lists it and it verifies", async () => {
    const { follower, adopted } = withoutWallet("b.example");
    await follower.check();
    expect(adopted).toEqual([B]);
    expect(follower.getSnapshot()).toEqual({ kind: "following", origin: B });
  });

  it("takes a node that is attested but not judged by the vault, which a visit with no wallet can never have, and pauses while it verifies", async () => {
    const { follower, adopted, trial } = withoutWallet("b.example");
    trial.verdict = { kind: "attested", release: "r", address: "0xk", why: "connect a wallet to check" };
    const states: string[] = [];
    follower.subscribe(() => states.push(follower.getSnapshot().kind));
    await follower.check();
    expect(adopted).toEqual([B]);
    expect(states).toEqual(["waiting", "following"]);
  });

  it("stays on the node in use when it names its own host, a hostname that is none, or says nothing", async () => {
    for (const hostname of ["build.example", null]) {
      const { follower, adopted } = withoutWallet(hostname);
      await follower.check();
      expect(adopted, String(hostname)).toEqual([]);
      expect(follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
    }
  });

  it("says the console needs updating for a host the build does not list, and stays", async () => {
    const { follower, adopted } = withoutWallet("evil.example");
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toEqual({ kind: "unlisted", origin: BUILD, hostname: "evil.example" });
  });

  it("does not move for a node that fails its check, and keeps the pause until it verifies", async () => {
    const { follower, adopted, trial } = withoutWallet("b.example");
    trial.verdict = { kind: "unverified", reason: "the quote did not verify" };
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, reason: "the quote did not verify" });
  });

  it("keeps trying the node the node in use named once that node stops answering, and moves when it verifies", async () => {
    const { follower, adopted, trial, current } = withoutWallet("b.example");
    trial.verdict = { kind: "unverified", reason: "the new operator is still taking the keys" };
    await follower.check();
    expect(follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B });
    // The outgoing node has handed over and stopped.
    current.signedRead = async () => { throw new EngineError(0, "The node did not answer."); };
    await follower.check();
    expect(follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B });
    trial.verdict = VERIFIED;
    await follower.check();
    expect(adopted).toEqual([B]);
    expect(follower.getSnapshot()).toEqual({ kind: "following", origin: B });
  });

  it("moves to the node a refused node says the registry names, after a promotion: the refusal carries the route", async () => {
    const kit = rig({ reads: null });
    const current = new TrialClient();
    current.signedRead = async () => { throw new RefusedAnswer("The vault names another signer", { ...ROUTE, api_hostname: { hostname: "b.example", block: 1, block_hash: "0x" } }); };
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
  });

  it("moves to the node a refused node says the registry names, though it still names its own turn, after a promotion", async () => {
    const kit = rig({ reads: null });
    const current = new TrialClient();
    const own = { turn: 9, position: 0, reason: "draw" as const, set: 3, candidate: "0x00000000000000000000000000000000000000a1", admin_key: "0x00000000000000000000000000000000000000a1", applies_at: 0, taken: true };
    current.operatorList = async () => ({ candidates: [{ address: own.candidate, api_hostname: "build.example" }] });
    current.signedRead = async () => ({ ...ROUTE, api_hostname: { hostname: "build.example", block: 1, block_hash: "0x" }, turn: own });
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
    // Promoted past, the node has stopped mirroring turns, while its read of the registry names the promoted operator.
    current.signedRead = async () => { throw new RefusedAnswer("The vault names another signer", { ...ROUTE, api_hostname: { hostname: "b.example", block: 2, block_hash: "0x" }, turn: own }); };
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
  });
});

describe("a daily turn with no wallet to read a chain (monkey-trading/console#280)", () => {
  const A = "0x00000000000000000000000000000000000000a1";
  const NEXT = "0x00000000000000000000000000000000000000b2";
  /** A follower on the build's node, whose route names its own turn and the next one, `ahead` ms away, and still the build's host as the registry's. */
  function turnAhead(ahead: number) {
    const kit = rig({ reads: null });
    const current = new TrialClient();
    const at = 1_000_000 + ahead;
    current.signedRead = async () => ({ api_hostname: { hostname: "build.example", block: 1, block_hash: "0x" }, rotation_enabled: true, turn: { candidate: A, applies_at: 0 }, next_turn: { candidate: NEXT, applies_at: at } });
    current.operatorList = async () => ({ candidates: [{ address: A, api_hostname: "build.example" }, { address: NEXT, api_hostname: "b.example" }] });
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    return { ...kit, current };
  }

  it("follows the next turn's member from its boundary, though the node handing over has stopped before its route named it", async () => {
    const { follower, adopted, current, advance } = turnAhead(60_000);
    await follower.check();
    expect(follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
    advance(61_000);
    current.signedRead = async () => { throw new EngineError(0, "The node did not answer."); };
    await follower.check();
    expect(adopted).toEqual([B]);
  });

  it("follows the turn's member while the node in use still names itself from the registry's finalized read, and not before the boundary", async () => {
    const { follower, adopted, advance } = turnAhead(60_000);
    await follower.check();
    expect(adopted).toEqual([]);
    advance(61_000);
    await follower.check();
    expect(adopted).toEqual([B]);
  });

  it("goes by the route's own hostname when the node's operator list cannot be read", async () => {
    const { follower, adopted, current, advance } = turnAhead(60_000);
    current.operatorList = async () => { throw new EngineError(0, "The node did not answer."); };
    await follower.check();
    advance(61_000);
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
  });
});

describe("a handover under way when the chain cannot be read", () => {
  it("keeps its pause, and does not report the failed read over it", async () => {
    const { follower, trial, setOperator, held } = rig();
    trial.verdict = { kind: "unverified", reason: "the quote did not verify" };
    await follower.check();
    expect(follower.getSnapshot().kind).toBe("waiting");
    held.chain = { vault: async () => { throw new Error("rpc down"); }, operator: async () => { throw new Error("rpc down"); } };
    setOperator(async () => { throw new Error("rpc down"); });
    await follower.check();
    expect(follower.getSnapshot().kind).toBe("waiting");
  });
});
