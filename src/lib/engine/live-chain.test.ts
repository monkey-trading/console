/** Tests for how a live client takes the connected wallet's chain reads: when it judges the node again, and how long a wallet may hold it. */

import { describe, expect, it, vi } from "vitest";

import type { AttestationStatus } from "./attestation";
import { LiveEngineClient } from "./live";
import { dev, markets } from "./live-setup";
import type { DeploymentReads, VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { FakeNode, FakeScheduler, settle } from "./test-kit";
import { VECTORS } from "./test-vectors";
import { NOT_THE_SIGNER } from "./trust";

const DIGEST = `0x${"5a".repeat(48)}` as const;
const NAMED: VaultFacts = { release: releaseName(DIGEST, `0x${"01".repeat(32)}`), signer: VECTORS.signer };

function rig(devDigests: readonly string[]) {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  const scheduler = new FakeScheduler();
  const clock = { now: markets.time_ms };
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000, loadVerifier: async () => dev,
    releases: [], devDigests, acceptsMock: true, fetch: node.fetch, openSocket: () => { throw new Error("no stream in these tests"); }, scheduler, nowMs: () => clock.now,
  });
  const attestations = () => node.requests.filter((r) => r.path === "/v1/attestation").length;
  return { client, scheduler, clock, attestations };
}

const reading = (vault: () => Promise<VaultFacts>): DeploymentReads => ({ vault, operator: async () => null, candidates: async () => null, delegateOf: async () => null });

describe("readChainThrough", () => {
  it("judges the node again when a wallet arrives, and not for the same wallet twice", async () => {
    const { client, attestations } = rig([DIGEST]);
    await client.verify();
    const reads = reading(async () => NAMED);
    await client.readChainThrough(reads);
    expect(attestations()).toBe(2);
    await client.readChainThrough(reads);
    expect(attestations()).toBe(2);
  });

  it("judges again after a check already running, which may have passed its read of the vault before the wallet came", async () => {
    const { client, attestations } = rig([DIGEST]);
    const first = client.verify(); // no wallet yet: this check may read no vault
    await client.readChainThrough(reading(async () => ({ ...NAMED, signer: "0xff" })));
    await first;
    expect(attestations()).toBe(2); // a run of its own, not the one already running
    await expect(client.markets()).rejects.toThrow(NOT_THE_SIGNER);
  });

  it("leaves a mock node with no stand-in digests alone, as nothing on chain can judge it", async () => {
    const { client, attestations } = rig([]);
    await client.verify();
    await client.readChainThrough(reading(async () => NAMED));
    expect(attestations()).toBe(1);
  });

  it("does not judge the node again when the wallet leaves", async () => {
    const { client, attestations } = rig([DIGEST]);
    await client.readChainThrough(reading(async () => NAMED));
    const before = attestations();
    await client.readChainThrough(null);
    expect(attestations()).toBe(before);
  });

  it("gives a wallet that does not answer ten seconds, then goes on without its word, so reads are not held", async () => {
    const { client, scheduler } = rig([DIGEST]);
    const statuses: AttestationStatus[] = [];
    client.watch((event) => { if (event.type === "attestation") statuses.push(event.status); });
    let asked = false;
    let settled = false;
    const judged = client.readChainThrough(reading(() => { asked = true; return new Promise(() => {}); })).then(() => { settled = true; });
    // The check reaches the wallet through real promises of the fake node's reads.
    await vi.waitFor(() => expect(asked).toBe(true));
    await settle();
    scheduler.advance(9_999);
    await settle();
    expect(settled).toBe(false);
    scheduler.advance(1);
    await judged;
    expect(settled).toBe(true);
    expect(statuses.at(-1)).toEqual({ kind: "unverified", reason: "Your wallet could not read the vault's current release: your wallet did not answer in time" });
  });

  it("keeps a good answer for thirty seconds, so a node that keeps failing its check does not cost a read per retry", async () => {
    const { client, clock } = rig([DIGEST]);
    let reads = 0;
    await client.readChainThrough(reading(async () => { reads += 1; return { ...NAMED, signer: "0xff" }; }));
    await client.verify();
    await client.verify();
    expect(reads).toBe(1);
    clock.now += 30_000;
    await client.verify();
    expect(reads).toBe(2);
  });

  it("does not keep a failed answer, nor another wallet's", async () => {
    const { client } = rig([DIGEST]);
    let reads = 0;
    await client.readChainThrough(reading(async () => { reads += 1; throw new Error("no answer"); }));
    await client.verify();
    expect(reads).toBe(2);
    let others = 0;
    await client.readChainThrough(reading(async () => { others += 1; return NAMED; }));
    expect(others).toBe(1);
  });
});

describe("heedVault", () => {
  it("judges the node again when the vault's signer is not the enclave it trusts, and not otherwise", async () => {
    const { client, attestations } = rig([DIGEST]);
    await client.readChainThrough(reading(async () => NAMED));
    const before = attestations();
    await client.heedVault(NAMED);
    expect(attestations()).toBe(before);
    await client.heedVault({ ...NAMED, signer: "0x00000000000000000000000000000000000000ff" });
    expect(attestations()).toBe(before + 1);
    await expect(client.markets()).rejects.toThrow(NOT_THE_SIGNER);
  });

  it("leaves a mock node with no stand-in digests alone", async () => {
    const { client, attestations } = rig([]);
    await client.verify();
    await client.heedVault({ ...NAMED, signer: "0x00000000000000000000000000000000000000ff" });
    expect(attestations()).toBe(1);
  });
});
