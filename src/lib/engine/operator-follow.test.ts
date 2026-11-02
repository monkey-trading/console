/** Tests for which node the console follows, and what a hostile chain read can make it do. */

import { describe, expect, it } from "vitest";

import { EngineError } from "./client";
import { operatorTarget } from "./operator-follow";
import { B, BUILD, DEPLOY, named, rig } from "./operator-follow-kit";
import { settle } from "./test-kit";

describe("operatorTarget", () => {
  it("names the operator's registered origin when the build lists it", () => {
    expect(operatorTarget(DEPLOY, named())).toEqual({ origin: B });
    expect(operatorTarget(DEPLOY, named({ hostname: "C.example:8443" }))).toEqual({ origin: "https://c.example:8443" });
  });

  it("stays on the build's node while rotation is off, whatever the registry names", () => {
    expect(operatorTarget(DEPLOY, named({ rotationEnabled: false }))).toEqual({ origin: BUILD });
  });

  it("stays on the build's node for an operator that registered no hostname", () => {
    expect(operatorTarget(DEPLOY, named({ hostname: null }))).toEqual({ origin: BUILD });
  });

  it("refuses a hostname the build does not list, and one that is not a plain host at all", () => {
    expect(operatorTarget(DEPLOY, named({ hostname: "EVIL.example" }))).toEqual({ unlisted: "evil.example" });
    expect(operatorTarget(DEPLOY, named({ hostname: "b.example:8443" }))).toEqual({ unlisted: "b.example:8443" });
    for (const hostname of ["https://b.example", "b.example/v1", "user@b.example", "*.example", "b.example?x", "а.example"]) {
      expect(operatorTarget(DEPLOY, named({ hostname })), hostname).toEqual({ unlisted: null });
    }
  });
});

describe("OperatorFollower.check", () => {
  it("stays pinned, reading nothing, with no wallet that reads a chain", async () => {
    const { follower, opened } = rig({ reads: null });
    await follower.check();
    expect(follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
    expect(opened).toEqual([]);
  });

  it("stays pinned from a build that names no registry", async () => {
    const { follower } = rig({ operator: async () => null });
    await follower.check();
    expect(follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
  });

  it("follows the build's node while rotation is off", async () => {
    const { follower, opened, adopted } = rig({ operator: async () => named({ rotationEnabled: false }) });
    await follower.check();
    expect(follower.getSnapshot()).toEqual({ kind: "following", origin: BUILD });
    expect([opened, adopted]).toEqual([[], []]);
  });

  it("moves to the operator's node only after its whole trust path holds, on a client given the wallet's reads", async () => {
    const { follower, trial, opened, adopted, reads } = rig();
    await follower.check();
    expect(opened.map((o) => o.origin)).toEqual([B]);
    expect(trial.chains).toEqual([reads]);
    expect(trial.verifies).toBe(1);
    expect(adopted).toEqual([B]);
    expect(follower.getSnapshot()).toEqual({ kind: "following", origin: B });
  });

  it("opens no client and connects nowhere for a hostname the build does not list, and says so", async () => {
    const { follower, opened, adopted } = rig({ operator: async () => named({ hostname: "evil.example" }) });
    await follower.check();
    expect(follower.getSnapshot()).toEqual({ kind: "unlisted", origin: BUILD, hostname: "evil.example" });
    expect([opened, adopted]).toEqual([[], []]);
  });

  it("stays on the node in use, and says why, when the target's attestation fails: a release the vault does not name, say", async () => {
    const { follower, trial, adopted } = rig();
    trial.verdict = { kind: "unverified", reason: "not the vault's release" };
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toEqual({ kind: "waiting", origin: BUILD, target: B, reason: "not the vault's release" });
  });

  it("does not move on a verdict the vault has not judged", async () => {
    const { follower, trial, adopted } = rig();
    trial.verdict = { kind: "attested", release: "r", address: "0xk", why: "the wallet could not read" };
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toMatchObject({ kind: "waiting", reason: "the wallet could not read" });
  });

  it("does not move to an enclave that serves its attestation and signs nothing, as one the vault does not name does", async () => {
    const { follower, trial, adopted } = rig();
    trial.signedRead = async () => { throw new Error("The node's answer was not signed by the attested enclave"); };
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toMatchObject({ kind: "waiting", reason: expect.stringContaining("not signed") });
  });

  it("moves to a node that signs its 404, one that predates the route", async () => {
    const { follower, trial, adopted } = rig();
    trial.signedRead = async () => { throw new EngineError(404, "not found"); };
    await follower.check();
    expect(adopted).toEqual([B]);
  });

  it("waits for a wallet request in flight to finish, then moves", async () => {
    const { follower, held, adopted } = rig();
    held.busy = true;
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toMatchObject({ kind: "waiting", reason: expect.stringContaining("wallet request") });
    held.busy = false;
    await follower.check();
    expect(adopted).toEqual([B]);
  });

  it("keeps the node in use when the chain read fails, and says so", async () => {
    const { follower, adopted } = rig({ operator: async () => { throw new Error("your wallet is on chain 1"); } });
    await follower.check();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toEqual({ kind: "failed", origin: BUILD, reason: "your wallet is on chain 1" });
  });

  it("does not move on an answer for a wallet that has since left", async () => {
    const { follower, held, adopted, trial } = rig();
    const signed = trial.signedRead;
    trial.signedRead = async () => { held.chain = null; return signed(); };
    await follower.check();
    await settle();
    expect(adopted).toEqual([]);
    expect(follower.getSnapshot()).toEqual({ kind: "pinned", origin: BUILD });
  });

  it("moves back to the build's node when rotation turns off after a move", async () => {
    const { follower, adopted, setOperator } = rig();
    await follower.check();
    setOperator(async () => named({ rotationEnabled: false }));
    await follower.check();
    expect(adopted).toEqual([B, BUILD]);
  });

  it("does not reopen a node once it follows it", async () => {
    const { follower, opened } = rig();
    await follower.check();
    await follower.check();
    expect(opened).toHaveLength(1);
  });

  it("keeps one client per target between attempts, and a new one for a new target", async () => {
    const { follower, trial, opened, setOperator } = rig();
    trial.verdict = { kind: "unverified", reason: "not yet" };
    await follower.check();
    await follower.check();
    expect(opened.map((o) => o.origin)).toEqual([B]);
    setOperator(async () => named({ hostname: "c.example:8443" }));
    await follower.check();
    expect(opened.map((o) => o.origin)).toEqual([B, "https://c.example:8443"]);
  });

  it("runs one read at a time, and once more when a wallet changes while it ran", async () => {
    let release = () => {};
    const { follower, operatorReads } = rig({ operator: () => new Promise((resolve) => { release = () => resolve(null); }) });
    const first = follower.check();
    const second = follower.check();
    expect(operatorReads.count).toBe(1);
    release();
    await first;
    await second;
    await settle();
    expect(operatorReads.count).toBe(2);
  });
});
