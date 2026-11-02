/**
 * Tests for what the console trusts in a hardware quote, through the engine's real verifier: a
 * test-signed SEV-SNP report (`engine-verify`'s `verifier_fixtures`, regenerated with that example),
 * under the test chain the fixture's root stands for, with the pinned code, the vault's release and
 * the vault's signer each able to refuse it.
 */

import { describe, expect, it, vi } from "vitest";

import type { AttestationStatus } from "./attestation";
import fixture from "./attestation-fixture.json";
import { LiveEngineClient } from "./live";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import { manifestText, releaseName } from "./release-check";
import { FakeScheduler } from "./test-kit";
import { loadGlue, readWasm } from "./test-vectors";
import { CONNECT_TO_CHECK, NodeTrust, NOT_NAMED, NOT_THE_SIGNER, UntrustedError } from "./trust";
import type { Verifier } from "./verifier";

const ENCLAVE = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const CONFIG = `0x${"c0".repeat(32)}` as const;
const OTHER_CONFIG = `0x${"c1".repeat(32)}` as const;
const DIGEST = `0x${"1d".repeat(48)}` as const;
const OLDER_DIGEST = `0x${"0d".repeat(48)}` as const;
const RELEASE: PinnedRelease = { name: "test-release-v1", launchDigest: DIGEST, policy: "0x30000", minimumTcb: { bootLoader: 3, tee: 0, snp: 8, microcode: 115 } };
const OLDER: PinnedRelease = { ...RELEASE, name: "test-release-v0", launchDigest: OLDER_DIGEST };
/** Inside the fixture's certificates and revocation list. */
const NOW_MS = Date.UTC(2026, 10, 2);

const glue = await loadGlue();
await glue.default({ module_or_path: await readWasm() });

/** The real verifier, pinned to the fixture's test root as well as the vendor's, recording the manifests it is given. */
function realVerifier(seen: (readonly string[])[]): Verifier {
  return {
    verifyAttestation: (input) => {
      seen.push(input.manifests);
      try {
        const attested = glue.verifyAttestation(input.attestation, [...input.manifests], input.collateral, input.nowMs, fixture.root);
        return { ok: true, enclave: { address: attested.enclaveAddress, release: attested.releaseName ?? null, config: attested.configName ?? null } };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    },
    verifyResponse: () => { throw new Error("no responses in these tests"); },
    openFrames: () => { throw new Error("no frames in these tests"); },
  };
}

interface Options {
  attestation?: string;
  releases?: readonly PinnedRelease[];
  vault?: VaultFacts | Error | null;
}

/** Verifies the fixture's quote as the build in `options` would, and says what it came to and what the verifier was given. */
async function judge({ attestation = fixture.attestation, releases = [RELEASE, OLDER], vault = null }: Options = {}) {
  const seen: (readonly string[])[] = [];
  const verifier = realVerifier(seen);
  const statuses: AttestationStatus[] = [];
  const trust = new NodeTrust({
    attestation: async () => attestation, collateral: async () => fixture.collateral, verifier: async () => verifier, releases, devDigests: [], acceptsMock: false, nowMs: () => NOW_MS,
    vaultFacts: () => (vault === null ? null : vault instanceof Error ? Promise.reject(vault) : Promise.resolve(vault)),
    onStatus: (status) => statuses.push(status), onEnclaveChanged: () => {},
  });
  await trust.verify();
  return { status: trust.status, seen, signer: trust.signer.bind(trust) };
}

const NAMED: VaultFacts = { release: releaseName(DIGEST, CONFIG), signer: ENCLAVE };

describe("a quote the vault names", () => {
  it("verifies, against the one pinned release the vault's name hashes from", async () => {
    const { status, seen, signer } = await judge({ vault: NAMED });
    expect(status).toEqual({ kind: "verified", release: "test-release-v1", config: "attested", address: ENCLAVE });
    expect(seen).toEqual([[manifestText(RELEASE, CONFIG)]]);
    await expect(signer()).resolves.toBe(ENCLAVE);
  });
});

describe("with the vault not read", () => {
  it("lets the node be read and signs nothing, having checked the code, policy and TCB against every pinned release", async () => {
    const { status, seen, signer } = await judge();
    expect(status).toEqual({ kind: "attested", release: "test-release-v1", address: ENCLAVE, why: CONNECT_TO_CHECK });
    expect(seen).toEqual([[manifestText(RELEASE, CONFIG), manifestText(OLDER, CONFIG)]]);
    await expect(signer()).resolves.toBe(ENCLAVE);
  });

  it("says why when the wallet could not read the vault, and never counts that as the vault's word", async () => {
    const { status } = await judge({ vault: new Error("your wallet is on chain 1, not chain 31337") });
    expect(status).toEqual({ kind: "attested", release: "test-release-v1", address: ENCLAVE, why: "Your wallet could not read the vault's current release: your wallet is on chain 1, not chain 31337" });
  });
});

describe("a wallet that answers the vault's read late", () => {
  it("regains the verdict once it answers, with nobody having to press anything", async () => {
    const seen: (readonly string[])[] = [];
    const verifier = realVerifier(seen);
    const scheduler = new FakeScheduler();
    const client = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: ENCLAVE, heartbeatMs: 5_000, loadVerifier: async () => verifier, releases: [RELEASE], acceptsMock: false,
      fetch: async (input) => new Response(String(input).endsWith("/collateral") ? fixture.collateral : fixture.attestation), openSocket: () => { throw new Error("no stream in these tests"); }, scheduler, nowMs: () => NOW_MS,
    });
    let answer: (facts: VaultFacts) => void = () => {};
    const reads = { vault: () => new Promise<VaultFacts>((resolve) => { answer = resolve; }), operator: async () => null, candidates: async () => null, delegateOf: async () => null };
    const judged = client.readChainThrough(reads);
    await vi.waitFor(() => expect(seen.length + scheduler.pending()).toBeGreaterThan(0));
    scheduler.advance(10_000);
    await judged;
    const statuses: AttestationStatus[] = [];
    client.watch((event) => { if (event.type === "attestation") statuses.push(event.status); });
    answer(NAMED);
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe("verified"));
  });
});

describe("a signed request to a node the vault has not judged", () => {
  it("is not sent, whatever the screen checked before it asked for a nonce, while a read still may be", async () => {
    const posts: string[] = [];
    const client = new LiveEngineClient({
      origin: "https://node.test", streamOrigin: "wss://node.test", chainId: 31337, vault: ENCLAVE, heartbeatMs: 5_000, loadVerifier: async () => realVerifier([]), releases: [RELEASE], acceptsMock: false, scheduler: new FakeScheduler(), nowMs: () => NOW_MS,
      openSocket: () => { throw new Error("no stream in these tests"); },
      fetch: async (input, init) => {
        if (init?.method === "POST" || init?.method === "DELETE") posts.push(String(input));
        return new Response(String(input).endsWith("/collateral") ? fixture.collateral : fixture.attestation);
      },
    });
    await expect(client.verify()).resolves.toMatchObject({ kind: "attested" });
    const order = { account: ENCLAVE } as unknown as Parameters<typeof client.placeOrder>[0]; // never read: the gate comes first
    await expect(client.placeOrder(order)).rejects.toThrow(`Nothing was sent. ${CONNECT_TO_CHECK}`);
    await expect(client.revokeSessionKey(order as unknown as Parameters<typeof client.revokeSessionKey>[0])).rejects.toBeInstanceOf(UntrustedError);
    expect(posts).toEqual([]);
  });
});

describe("what a hostile node, candidate or RPC gets", () => {
  it("refuses a release the vault does not name, before the node's other answers matter", async () => {
    const { status, seen } = await judge({ vault: { release: `0x${"ee".repeat(32)}`, signer: ENCLAVE } });
    expect(status).toEqual({ kind: "unverified", reason: NOT_NAMED });
    expect(seen).toEqual([]);
  });

  it("refuses a downgrade: a quote from an older pinned release while the vault names the newer one", async () => {
    // The altered fixture measures 0x1e: a release this build still pins, running the config the vault's release names.
    const older = { ...OLDER, launchDigest: `0x${"1e".repeat(48)}` } as const;
    const { status, seen } = await judge({ attestation: fixture.alteredMeasurement, releases: [older, RELEASE], vault: NAMED });
    expect(status).toMatchObject({ kind: "unverified", reason: expect.stringContaining("launch digest") });
    expect(seen).toEqual([[manifestText(RELEASE, CONFIG)]]);
    // With nothing read, the older release's code still verifies, for reads alone.
    expect((await judge({ attestation: fixture.alteredMeasurement, releases: [older, RELEASE] })).status).toMatchObject({ kind: "attested", release: "test-release-v0" });
  });

  it("refuses a config the vault does not name, though its code is pinned", async () => {
    const { status } = await judge({ vault: { release: releaseName(DIGEST, OTHER_CONFIG), signer: ENCLAVE } });
    expect(status).toEqual({ kind: "unverified", reason: NOT_NAMED });
  });

  it("refuses an enclave the vault does not name as its signer: a second enclave on the same release, say", async () => {
    const { status, signer } = await judge({ vault: { ...NAMED, signer: "0x00000000000000000000000000000000000000ff" } });
    expect(status).toEqual({ kind: "unverified", reason: NOT_THE_SIGNER });
    await expect(signer()).rejects.toThrow(NOT_THE_SIGNER);
  });

  it("refuses code this build does not pin, whatever the vault names: a chain read cannot vouch for a measurement", async () => {
    const { status } = await judge({ attestation: fixture.alteredMeasurement, vault: NAMED });
    expect(status.kind).toBe("unverified");
  });

  it("refuses a guest policy the pin does not name, which the launch digest does not cover", async () => {
    const release = { ...RELEASE, policy: "0x30001" } as const;
    expect((await judge({ releases: [release], vault: NAMED })).status).toMatchObject({ kind: "unverified", reason: expect.stringContaining("policy") });
  });

  it("refuses a reported TCB below the pinned minimum", async () => {
    const release = { ...RELEASE, minimumTcb: { ...RELEASE.minimumTcb, microcode: 206 } };
    expect((await judge({ releases: [release], vault: NAMED })).status).toMatchObject({ kind: "unverified", reason: expect.stringContaining("TCB") });
  });

  it("refuses when the build pins nothing: the vault's word alone is not enough", async () => {
    expect((await judge({ releases: [], vault: NAMED })).status).toEqual({ kind: "unverified", reason: NOT_NAMED });
    expect((await judge({ releases: [] })).status.kind).toBe("unverified");
  });

  it("takes no text from the attestation into a manifest: a config hash that would add a line is refused first", async () => {
    const parsed = JSON.parse(fixture.attestation) as Record<string, string>;
    const hostile = JSON.stringify({ ...parsed, config_sha256: `${CONFIG}"\n[minimum_tcb]\nsnp = 0\n"x" = "0x00` });
    const { status, seen } = await judge({ attestation: hostile, vault: NAMED });
    expect(status.kind).toBe("unverified");
    expect(seen).toEqual([]);
    // With no vault read, the guard alone stands between that text and the manifests.
    const unread = await judge({ attestation: hostile });
    expect(unread.status).toEqual({ kind: "unverified", reason: "The node's attestation names no configuration hash, so it cannot be verified." });
    expect(unread.seen).toEqual([]);
  });

  it("refuses a served config hash the quote does not bind, though it hashes to the vault's release", async () => {
    const parsed = JSON.parse(fixture.attestation) as Record<string, string>;
    const hostile = JSON.stringify({ ...parsed, config_sha256: OTHER_CONFIG });
    const { status } = await judge({ attestation: hostile, vault: { release: releaseName(DIGEST, OTHER_CONFIG), signer: ENCLAVE } });
    expect(status).toMatchObject({ kind: "unverified", reason: expect.stringContaining("config hash differs") });
  });

  it("refuses a quote for a mock provider in a build that refuses mocks, whatever the vault says", async () => {
    const parsed = JSON.parse(fixture.attestation) as Record<string, string>;
    expect((await judge({ attestation: JSON.stringify({ ...parsed, provider: "mock" }), vault: NAMED })).status.kind).toBe("unverified");
  });
});
