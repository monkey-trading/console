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

/** The trust of a node whose route states no signer, whose enclave attests `held.address` at each check; `vault.facts` is the wallet's read of the vault then, null with no wallet. */
function silentTrust(provider: (typeof PROVIDERS)[number]) {
  const held = { address: KA };
  const vault: { facts: VaultFacts | null } = { facts: null };
  const verifier: Verifier = { ...dev, verifyAttestation: () => ({ ok: true, enclave: { address: held.address, release: RELEASE.name, config: "attested" } }) };
  const trust = new NodeTrust({
    attestation: async () => (provider === "mock" ? mockAttestation(held.address) : HARDWARE), collateral: async () => (provider === "mock" ? null : "{}"),
    verifier: async () => verifier, releases: [RELEASE], devDigests: provider === "mock" ? [DIGEST] : [], acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => (vault.facts === null ? null : Promise.resolve(vault.facts)), onStatus: () => {}, onEnclaveChanged: () => {},
    operatorClaim: async () => ({}),
  });
  return { trust, held, vault, release: releaseName(DIGEST, provider === "mock" ? MOCK_CONFIG : CONFIG) };
}

/** A node in use whose route states no signer, trusted under KA with no wallet, which another node's word then puts KB to at epoch 8. */
async function silentNode(provider: (typeof PROVIDERS)[number]) {
  const node = silentTrust(provider);
  await node.trust.verify();
  expect(node.trust.status.kind, provider).toBe(provider === "mock" ? "mock" : "attested");
  node.trust.heedSigner({ epoch: 8, address: KB });
  expect(node.trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
  return node;
}

describe("a node that states no signer under another node's later word (monkey-trading/console#376)", () => {
  it("refuses a key its enclave changes to that the word does not name, with no read of the vault, and goes on refusing it", async () => {
    for (const provider of PROVIDERS) {
      const { trust, held } = await silentNode(provider);
      held.address = KC;
      await expect(trust.recheck(KA), provider).resolves.toBe(false);
      expect(trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
      expect(trust.refuses(KC), provider).toBe(true);
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

  it("puts that key aside once a check with no read of the vault refuses it, so an answer in flight under it is refused, until the vault names it again", async () => {
    for (const provider of PROVIDERS) {
      const { trust, held, vault, release } = await silentNode(provider);
      held.address = KC;
      vault.facts = { release, signer: KC };
      await trust.verify();
      expect(trust.refuses(KC), provider).toBe(false);
      // The wallet goes, and a failed answer has the node checked again.
      vault.facts = null;
      await trust.verify();
      expect(trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
      expect(trust.refuses(KC), provider).toBe(true);
      vault.facts = { release, signer: KC };
      await trust.verify();
      expect([trust.status.kind, trust.refuses(KC)], provider).toEqual([provider === "mock" ? "mock" : "verified", false]);
    }
  });
});

describe("a node moved to under a signer the visit heard before (monkey-trading/console#376)", () => {
  it("keeps the verdict its own read of the vault reached, and refuses a key it changes to with no read of the vault", async () => {
    for (const provider of PROVIDERS) {
      // The follower moved to this node once the wallet's read of the vault named its enclave KB.
      const { trust, held, vault, release } = silentTrust(provider);
      held.address = KB;
      vault.facts = { release, signer: KB };
      await trust.verify();
      // Its own word named KB once, before it stopped stating a signer.
      trust.heedOperator({ signer: { epoch: 7, address: KB } });
      trust.holdSigner({ epoch: 8, address: KA });
      expect([trust.status.kind, trust.refuses(KB), trust.signerNamed], provider).toEqual([provider === "mock" ? "mock" : "verified", false, { epoch: 8, address: KA }]);
      // The wallet goes, and the enclave answers under KC.
      vault.facts = null;
      held.address = KC;
      await expect(trust.recheck(KB), provider).resolves.toBe(false);
      expect(trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
    }
  });
});
