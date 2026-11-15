/**
 * Tests for the vault's word on its signer, read through the wallet (monkey-trading/console#280): the enclave trusted last is put aside
 * the moment the vault names another key, so an answer still in flight under it is refused whatever the check that follows decides.
 */

import { describe, expect, it } from "vitest";

import { dev } from "./live-setup";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { mockAttestation } from "./test-kit";
import { NodeTrust, NOT_NAMED, NOT_THE_SIGNER } from "./trust";
import type { Verifier } from "./verifier";

const OLD = "0x00000000000000000000000000000000000000aa";
const NEW = "0x00000000000000000000000000000000000000bb";
const CONFIG = `0x${"c0".repeat(32)}` as const;
const DIGEST = `0x${"1d".repeat(48)}` as const;
const UNPINNED = `0x${"0d".repeat(48)}` as const;
const RELEASE: PinnedRelease = { name: "test-release-v1", launchDigest: DIGEST, policy: "0x30000", minimumTcb: { bootLoader: 3, tee: 0, snp: 8, microcode: 115 } };
const HARDWARE = JSON.stringify({ provider: "sev_snp", config_sha256: CONFIG });

/** What the next check meets: the vault's facts, the collateral the node serves, and whether its quote verifies. */
interface Node {
  vault: VaultFacts | null;
  collateral: string | null;
  verifies: boolean;
}

/** A hardware node trusted under OLD, whose vault, collateral and quote each test then changes. */
async function trustedHardware() {
  const node: Node = { vault: { release: releaseName(DIGEST, CONFIG), signer: OLD }, collateral: "{}", verifies: true };
  const verifier: Verifier = { ...dev, verifyAttestation: () => (node.verifies ? { ok: true, enclave: { address: OLD, release: "test-release-v1", config: "attested" } } : { ok: false, reason: "the quote does not verify" }) };
  const trust = new NodeTrust({
    attestation: async () => HARDWARE, collateral: async () => node.collateral, verifier: async () => verifier, releases: [RELEASE], devDigests: [], acceptsMock: false, nowMs: () => 0,
    vaultFacts: () => (node.vault === null ? null : Promise.resolve(node.vault)), onStatus: () => {}, onEnclaveChanged: () => {},
  });
  await trust.verify();
  expect(trust.status.kind).toBe("verified");
  return { node, trust };
}

describe("the vault naming another signer than the enclave trusted last", () => {
  const failures: { failure: string; change: (node: Node) => void; reason: string | RegExp }[] = [
    { failure: "the release check", change: (node) => { node.vault = { release: releaseName(UNPINNED, CONFIG), signer: NEW }; }, reason: NOT_NAMED },
    { failure: "the collateral", change: (node) => { node.vault = { release: releaseName(DIGEST, CONFIG), signer: NEW }; node.collateral = null; }, reason: /collateral/ },
    { failure: "the quote", change: (node) => { node.vault = { release: releaseName(DIGEST, CONFIG), signer: NEW }; node.verifies = false; }, reason: /does not verify/ },
    { failure: "the signer check", change: (node) => { node.vault = { release: releaseName(DIGEST, CONFIG), signer: NEW }; }, reason: NOT_THE_SIGNER },
  ];

  it("puts that enclave aside before the check's own read can fail, whichever step then fails", async () => {
    for (const { failure, change, reason } of failures) {
      const { node, trust } = await trustedHardware();
      change(node);
      await trust.verify();
      expect(trust.status, failure).toMatchObject({ kind: "unverified", reason: typeof reason === "string" ? reason : expect.stringMatching(reason) });
      expect(trust.refuses(OLD), failure).toBe(true);
    }
  });

  it("puts that enclave aside the moment the wallet's read elsewhere says so, before the check it starts can fail", async () => {
    for (const { failure, change } of failures) {
      const { node, trust } = await trustedHardware();
      change(node);
      const facts = node.vault;
      if (facts === null) throw new Error("each change names a vault");
      const judging = trust.heedVault(facts.signer);
      // An answer in flight under OLD lands while the check runs: OLD is already refused.
      expect(trust.refuses(OLD), failure).toBe(true);
      await judging;
      expect(trust.refuses(OLD), failure).toBe(true);
    }
  });

  it("leaves the enclave it names alone when a check of it fails, and puts nothing aside at a first check", async () => {
    const { node, trust } = await trustedHardware();
    node.collateral = null;
    await trust.verify();
    expect(trust.refuses(OLD)).toBe(false);
    const fresh = new NodeTrust({
      attestation: async () => HARDWARE, collateral: async () => "{}", verifier: async () => dev, releases: [RELEASE], devDigests: [], acceptsMock: false, nowMs: () => 0,
      vaultFacts: () => Promise.resolve({ release: releaseName(UNPINNED, CONFIG), signer: NEW }), onStatus: () => {}, onEnclaveChanged: () => {},
    });
    await fresh.verify();
    expect(fresh.status).toEqual({ kind: "unverified", reason: NOT_NAMED });
    expect([fresh.refuses(OLD), fresh.refuses(NEW)]).toEqual([false, false]);
  });
});

describe("a dev build's mock node under the vault's word", () => {
  /** The config hash `mockAttestation` serves. */
  const MOCK_CONFIG = `0x${"01".repeat(32)}` as const;

  it("puts the mock enclave aside when the vault names another, at its release check or at its signer check, as a hardware quote's", async () => {
    const vault: { facts: VaultFacts } = { facts: { release: releaseName(DIGEST, MOCK_CONFIG), signer: OLD } };
    const trust = new NodeTrust({
      attestation: async () => mockAttestation(OLD), collateral: async () => null, verifier: async () => dev, releases: [], devDigests: [DIGEST], acceptsMock: true, nowMs: () => 0,
      vaultFacts: () => Promise.resolve(vault.facts), onStatus: () => {}, onEnclaveChanged: () => {},
    });
    await trust.verify();
    expect(trust.status.kind).toBe("mock");
    vault.facts = { release: releaseName(UNPINNED, MOCK_CONFIG), signer: NEW };
    await trust.verify();
    expect(trust.status).toEqual({ kind: "unverified", reason: NOT_NAMED });
    expect(trust.refuses(OLD)).toBe(true);
    // The vault names the mock enclave again: its next check takes it back.
    vault.facts = { release: releaseName(DIGEST, MOCK_CONFIG), signer: OLD };
    await trust.verify();
    expect([trust.status.kind, trust.refuses(OLD)]).toEqual(["mock", false]);
    vault.facts = { release: releaseName(DIGEST, MOCK_CONFIG), signer: NEW };
    await trust.verify();
    expect(trust.status).toEqual({ kind: "unverified", reason: NOT_THE_SIGNER });
    expect(trust.refuses(OLD)).toBe(true);
  });
});
