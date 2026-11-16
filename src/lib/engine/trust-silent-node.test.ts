/**
 * Tests for a node whose operator route states no signer, once another node's word has named a later one (monkey-trading/console#376):
 * a key its enclave changes to is taken only when the highest word heard names it, or the check's own read of the vault does.
 */

import { describe, expect, it } from "vitest";

import { dev } from "./live-setup";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { SIGNER_SUPERSEDED } from "./signer-naming";
import { mockAttestation } from "./test-kit";
import { NodeTrust } from "./trust";
import type { Verifier } from "./verifier";

const KA = "0x00000000000000000000000000000000000000a1";
const KB = "0x00000000000000000000000000000000000000b1";
const KC = "0x00000000000000000000000000000000000000c1";
const CONFIG = `0x${"c0".repeat(32)}` as const;
/** The config hash `mockAttestation` serves. */
const MOCK_CONFIG = `0x${"01".repeat(32)}` as const;
const DIGEST = `0x${"1d".repeat(48)}` as const;
const RELEASE: PinnedRelease = { name: "test-release-v1", launchDigest: DIGEST, policy: "0x30000", minimumTcb: { bootLoader: 3, tee: 0, snp: 8, microcode: 115 } };
const HARDWARE = JSON.stringify({ provider: "sev_snp", config_sha256: CONFIG });
const PROVIDERS = ["hardware", "mock"] as const;

/**
 * A node in use whose route states no signer, trusted under KA with no wallet, which another node's word then puts KB to at epoch 8. Its
 * enclave attests `held.address` at the next check, and `vault.facts` is the wallet's read of the vault then, null with no wallet.
 */
async function silentNode(provider: (typeof PROVIDERS)[number]) {
  const held = { address: KA };
  const vault: { facts: VaultFacts | null } = { facts: null };
  const verifier: Verifier = { ...dev, verifyAttestation: () => ({ ok: true, enclave: { address: held.address, release: RELEASE.name, config: "attested" } }) };
  const trust = new NodeTrust({
    attestation: async () => (provider === "mock" ? mockAttestation(held.address) : HARDWARE), collateral: async () => (provider === "mock" ? null : "{}"),
    verifier: async () => verifier, releases: [RELEASE], devDigests: provider === "mock" ? [DIGEST] : [], acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => (vault.facts === null ? null : Promise.resolve(vault.facts)), onStatus: () => {}, onEnclaveChanged: () => {},
    operatorClaim: async () => ({}),
  });
  await trust.verify();
  expect(trust.status.kind, provider).toBe(provider === "mock" ? "mock" : "attested");
  trust.heedSigner({ epoch: 8, address: KB });
  expect(trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
  return { trust, held, vault, release: releaseName(DIGEST, provider === "mock" ? MOCK_CONFIG : CONFIG) };
}

describe("a node that states no signer under another node's later word (monkey-trading/console#376)", () => {
  it("refuses a key its enclave changes to that the word does not name, with no read of the vault, and goes on refusing it", async () => {
    for (const provider of PROVIDERS) {
      const { trust, held } = await silentNode(provider);
      held.address = KC;
      await expect(trust.recheck(KA), provider).resolves.toBe(false);
      expect(trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
      await expect(trust.signer(), provider).rejects.toThrow(SIGNER_SUPERSEDED);
    }
  });

  it("takes a key its enclave changes to that the word names", async () => {
    for (const provider of PROVIDERS) {
      const { trust, held } = await silentNode(provider);
      held.address = KB;
      await expect(trust.recheck(KA), provider).resolves.toBe(true);
      expect(trust.status.kind, provider).toBe(provider === "mock" ? "mock" : "attested");
    }
  });

  it("takes a key the word does not name when the check's own read of the vault names it", async () => {
    for (const provider of PROVIDERS) {
      const { trust, held, vault, release } = await silentNode(provider);
      held.address = KC;
      vault.facts = { release, signer: KC };
      await expect(trust.recheck(KA), provider).resolves.toBe(true);
      expect(trust.status.kind, provider).toBe(provider === "mock" ? "mock" : "verified");
    }
  });
});
