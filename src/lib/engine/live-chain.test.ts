/** Tests for how a live client takes the connected wallet's chain reads: when it judges the node again, and how long a wallet may hold it. */

import { describe, expect, it, vi } from "vitest";

import type { AttestationStatus } from "./attestation";
import { LiveEngineClient } from "./live";
import { dev, markets } from "./live-setup";
import type { DeploymentReads, VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { FakeNode, FakeScheduler, settle } from "./test-kit";
import { VECTORS } from "./test-vectors";

const DIGEST = `0x${"5a".repeat(48)}` as const;
const NAMED: VaultFacts = { release: releaseName(DIGEST, `0x${"01".repeat(32)}`), signer: VECTORS.signer };

function rig(devDigests: readonly string[]) {
  const node = new FakeNode();
  node.attestation(() => VECTORS.signer);
  const scheduler = new FakeScheduler();
  const client = new LiveEngineClient({
    origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: markets.vault, heartbeatMs: 5_000, loadVerifier: async () => dev,
    releases: [], devDigests, acceptsMock: true, fetch: node.fetch, openSocket: () => { throw new Error("no stream in these tests"); }, scheduler, nowMs: () => markets.time_ms,
  });
  const attestations = () => node.requests.filter((r) => r.path === "/v1/attestation").length;
  return { client, scheduler, attestations };
}

const reading = (vault: () => Promise<VaultFacts>): DeploymentReads => ({ vault, operator: async () => null, candidates: async () => null });

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
    const { client } = rig([DIGEST]);
    const statuses: AttestationStatus[] = [];
    client.watch((event) => { if (event.type === "attestation") statuses.push(event.status); });
    const asked = { vault: 0 };
    const first = client.verify(); // no wallet yet: this check reads no vault
    await client.readChainThrough(reading(async () => { asked.vault += 1; return { ...NAMED, signer: "0xff" }; }));
    await first;
    expect(asked.vault).toBe(1);
    expect(statuses.at(-1)).toMatchObject({ kind: "unverified" });
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
});
