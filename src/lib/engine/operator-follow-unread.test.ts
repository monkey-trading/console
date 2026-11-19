/** Tests for a change of server while the wallet's reads of the chain fail: the change is held for that, with its reason, and goes on once they work (monkey-trading/console#494). */

import { describe, expect, it } from "vitest";

import type { AttestationStatus } from "./attestation";
import type { EngineClient } from "./client";
import { B, named, rig, TrialClient, VERIFIED } from "./operator-follow-kit";
import { settle } from "./test-kit";

const NOT_ANSWERING: AttestationStatus = { kind: "unverified", reason: "The server did not respond.", notReady: true };

/** A follower whose chain names `B`, which is not answering yet, so the change is waiting at `connecting`. */
async function connecting() {
  const successor = new TrialClient();
  successor.verdict = NOT_ANSWERING;
  const kit = rig({ operator: async () => named({ hostname: "b.example" }), clients: { [B]: successor } });
  kit.follower.watch(kit.trial as unknown as EngineClient); // the follower uses only what TrialClient has
  await kit.follower.check();
  expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, stage: "connecting" });
  return { ...kit, successor };
}

describe("a change of server while the wallet's reads fail", () => {
  it("holds it for a failed read of the vault, and goes on once the wallet reads it again", async () => {
    const kit = await connecting();
    kit.reads.vault = async () => { throw new Error("the provider did not respond"); };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, stage: "unread", reason: "the provider did not respond" });
    kit.reads.vault = async () => ({ release: "0x", signer: "0x" });
    kit.successor.verdict = VERIFIED;
    await kit.follower.check();
    await settle();
    expect(kit.adopted).toEqual([B]);
  });

  it("holds it for a failed read of the registry", async () => {
    const kit = await connecting();
    kit.setOperator(async () => { throw new Error("the wallet is on another network"); });
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, stage: "unread", reason: "the wallet is on another network" });
  });

  it("holds it for a server whose check could not read the vault through the wallet", async () => {
    const kit = await connecting();
    kit.successor.verdict = { kind: "attested", release: "r", address: "0xk", why: "Your wallet could not check the server against the vault." };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, stage: "unread" });
  });

  it("keeps a refusal of the next server, which says more than a failed read does", async () => {
    const kit = await connecting();
    kit.successor.verdict = { kind: "unverified", reason: "not the vault's release" };
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ stage: "refused" });
    kit.setOperator(async () => { throw new Error("the wallet is on another network"); });
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ stage: "refused", reason: "not the vault's release" });
  });
});
