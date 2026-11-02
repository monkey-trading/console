/** Tests for how the follower hands what the vault says to the client in use, on every path of a check. */

import { describe, expect, it } from "vitest";

import type { EngineClient } from "./client";
import { named, rig, TrialClient } from "./operator-follow-kit";
import type { NamedOperator } from "./registry";

describe("what the vault says", () => {
  /** A rig watching a client in use, the vault answering `facts`. */
  function inUse(operator: () => Promise<NamedOperator | null>, facts = { release: "0x1", signer: "0xa" }) {
    const kit = rig({ operator });
    kit.reads.vault = async () => facts;
    const client = new TrialClient();
    kit.follower.watch(client as unknown as EngineClient); // the follower uses only what TrialClient has
    return { ...kit, client, facts };
  }

  it("reaches the client in use on every path, whatever comes of the operator's node", async () => {
    const paths: [string, () => Promise<NamedOperator | null>][] = [
      ["no registry", async () => null],
      ["the node in use is the operator's", async () => named({ hostname: null })],
      ["a hostname the build does not list", async () => named({ hostname: "evil.example" })],
      ["a move", async () => named()],
    ];
    for (const [path, operator] of paths) {
      const { follower, client, facts } = inUse(operator);
      await follower.check();
      expect(client.heeded, path).toEqual([facts]);
    }
    const waiting = inUse(async () => named());
    waiting.trial.verdict = { kind: "unverified", reason: "not yet" };
    await waiting.follower.check();
    expect(waiting.follower.getSnapshot().kind).toBe("waiting");
    expect(waiting.client.heeded).toEqual([waiting.facts]);
  });

  it("hears nothing from a wallet that left while it read", async () => {
    const kit = inUse(async () => named());
    const read = kit.reads.vault;
    kit.reads.vault = () => { kit.held.chain = null; return read(); };
    await kit.follower.check();
    expect(kit.client.heeded).toEqual([]);
    expect(kit.adopted).toEqual([]);
  });

  it("reaches the client in use though the registry read fails", async () => {
    const { follower, client, facts } = inUse(async () => { throw new Error("no answer"); });
    await follower.check();
    expect(client.heeded).toEqual([facts]);
    expect(follower.getSnapshot()).toMatchObject({ kind: "failed", reason: "no answer" });
  });

  it("says so when the read fails, and keeps the node in use", async () => {
    const kit = rig({ operator: async () => named({ rotationEnabled: false }) });
    kit.reads.vault = async () => { throw new Error("no answer"); };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toEqual({ kind: "failed", origin: "https://build.example", reason: "no answer" });
    expect(kit.adopted).toEqual([]);
  });
});
