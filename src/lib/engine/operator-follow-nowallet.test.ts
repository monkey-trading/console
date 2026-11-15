/** Tests for a visit with no wallet to read a chain, and for a handover under way (monkey-trading/console#280). */

import { describe, expect, it } from "vitest";

import { EngineError, type EngineClient } from "./client";
import { B, BUILD, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { RefusedAnswer } from "./trust-errors";

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
    current.signedRead = async () => { throw new RefusedAnswer("The vault names another signer", { rotation_enabled: true, api_hostname: { hostname: "b.example", block: 1, block_hash: "0x" } }); };
    kit.follower.watch(current as unknown as EngineClient); // the follower uses only what TrialClient has
    await kit.follower.check();
    expect(kit.adopted).toEqual([B]);
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
