/**
 * Tests for a node whose operator route states no signer, once another node's word has named a later one (monkey-trading/console#376):
 * a key its enclave changes to is taken only when the highest word heard names it, or the check's own read of the vault does; a refusal
 * for want of that read is decided again when a read comes (#379), and two keys named at the highest epoch name none (#381).
 */

import { describe, expect, it } from "vitest";

import { dev } from "./live-setup";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { SIGNER_SUPERSEDED, SIGNER_UNREAD, type OperatorClaim } from "./signer-naming";
import { mockAttestation, settle } from "./test-kit";
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
 * The trust of a node whose route states no signer unless `held.claim` says otherwise, whose enclave attests `held.address` at each check, counted
 * in `held.checks`; `vault.facts` is the wallet's read of the vault then, null with no wallet and an error when the read fails.
 */
function silentTrust(provider: (typeof PROVIDERS)[number], devDigests: readonly string[] = provider === "mock" ? [DIGEST] : []) {
  const held: { address: string; claim: OperatorClaim | Error; checks: number } = { address: KA, claim: {}, checks: 0 };
  const vault: { facts: VaultFacts | Error | null } = { facts: null };
  const verifier: Verifier = { ...dev, verifyAttestation: () => ({ ok: true, enclave: { address: held.address, release: RELEASE.name, config: "attested" } }) };
  const trust = new NodeTrust({
    attestation: async () => { held.checks += 1; return provider === "mock" ? mockAttestation(held.address) : HARDWARE; }, collateral: async () => (provider === "mock" ? null : "{}"),
    verifier: async () => verifier, releases: [RELEASE], devDigests, acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => (vault.facts === null ? null : vault.facts instanceof Error ? Promise.reject(vault.facts) : Promise.resolve(vault.facts)), onStatus: () => {}, onEnclaveChanged: () => {},
    operatorClaim: async () => { if (held.claim instanceof Error) throw held.claim; return held.claim; },
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

describe("a node refused for want of a read of the vault (monkey-trading/console#379)", () => {
  const LATE = new Error("your wallet did not answer in time");
  /** A node trusted under KB through the wallet's read of the vault, refused by a check whose read failed: held to KA at a later epoch, or put aside by an earlier read naming KA. */
  async function refusedUnread(provider: (typeof PROVIDERS)[number], cause: "a later word" | "an earlier read") {
    const node = silentTrust(provider);
    node.held.address = KB;
    node.vault.facts = { release: node.release, signer: KB };
    await node.trust.verify();
    if (cause === "a later word") node.trust.holdSigner({ epoch: 8, address: KA });
    else {
      node.vault.facts = { release: node.release, signer: KA };
      await node.trust.heedVault(KA);
    }
    node.vault.facts = LATE;
    await node.trust.verify();
    expect(node.trust.status.kind, `${provider}, ${cause}`).toBe("unverified");
    return node;
  }

  it("checks it again once that read lands late, or the follower's read comes, and takes it when the read names its enclave", async () => {
    const cases = PROVIDERS.flatMap((provider) => (["a later word", "an earlier read"] as const).flatMap((cause) => (["late", "the follower's"] as const).map((read) => ({ provider, cause, read }))));
    for (const { provider, cause, read } of cases) {
      const { trust, vault, release } = await refusedUnread(provider, cause);
      vault.facts = { release, signer: KB };
      if (read === "late") trust.vaultAnsweredLate();
      else await trust.heedVault(KB);
      await settle();
      expect([trust.status.kind, trust.refuses(KB)], `${provider}, ${cause}, ${read}`).toEqual([provider === "mock" ? "mock" : "verified", false]);
    }
  });

  it("leaves alone a refusal no read of the vault would lift: the node's own word, a word that could not be read, and a mock node no read judges", async () => {
    const refusals = [
      { refusal: "its own word names another key", provider: "hardware", claim: { signer: { epoch: 9, address: KA } }, reason: SIGNER_SUPERSEDED },
      { refusal: "its word could not be read", provider: "hardware", claim: new Error("Failed to fetch"), reason: expect.stringContaining(SIGNER_UNREAD) },
      { refusal: "a mock node with no stand-in digests", provider: "mock", claim: {}, reason: SIGNER_SUPERSEDED },
    ] as const;
    for (const { refusal, provider, claim, reason } of refusals) {
      const { trust, held, vault, release } = silentTrust(provider, []);
      held.address = KB;
      trust.holdSigner({ epoch: 8, address: KA });
      held.claim = claim;
      vault.facts = LATE;
      await trust.verify();
      expect(trust.status, refusal).toEqual({ kind: "unverified", reason });
      const checks = held.checks;
      vault.facts = { release, signer: KB };
      trust.vaultAnsweredLate();
      await trust.heedVault(KB);
      await settle();
      expect([held.checks, trust.status], refusal).toEqual([checks, { kind: "unverified", reason }]);
    }
  });
});

describe("a node moved to while two keys were named at the highest epoch (monkey-trading/console#381)", () => {
  it("keeps the verdict its own read of the vault reached, is refused at a check with no read, and is taken at a check that reads the vault", async () => {
    for (const provider of PROVIDERS) {
      const { trust, held, vault, release } = silentTrust(provider);
      held.address = KB;
      vault.facts = { release, signer: KB };
      await trust.verify();
      trust.holdSigner({ epoch: 8, address: null });
      expect([trust.status.kind, trust.refuses(KB), trust.signerNamed], provider).toEqual([provider === "mock" ? "mock" : "verified", false, { epoch: 8, address: null }]);
      vault.facts = null;
      await trust.verify();
      expect(trust.status, provider).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
      vault.facts = { release, signer: KB };
      await trust.verify();
      expect(trust.status.kind, provider).toBe(provider === "mock" ? "mock" : "verified");
    }
  });

  it("names neither key once a word at that epoch puts the other to it, whichever came first, until a later epoch names one", async () => {
    for (const [first, second] of [[KA, KB], [KB, KA]] as const) {
      // Trusted under KC through the wallet's read of the vault, held to the first key, then told the second.
      const { trust, held, vault, release } = silentTrust("hardware");
      held.address = KC;
      vault.facts = { release, signer: KC };
      await trust.verify();
      trust.holdSigner({ epoch: 8, address: first });
      trust.heedSigner({ epoch: 8, address: second });
      expect(trust.signerNamed, first).toEqual({ epoch: 8, address: null });
      // The wallet goes, and the enclave answers under the key named first.
      vault.facts = null;
      held.address = first;
      await trust.verify();
      expect(trust.status, first).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
      trust.heedSigner({ epoch: 9, address: first });
      await trust.verify();
      expect([trust.status.kind, trust.signerNamed], first).toEqual(["attested", { epoch: 9, address: first }]);
    }
  });
});
