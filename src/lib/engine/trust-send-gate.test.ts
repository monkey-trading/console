/** Tests for the last gate on a signed request: which verdicts pass it, and that every refusal says nothing left the page. */

import { describe, expect, it } from "vitest";

import { dev, markets, setup } from "./live-setup";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { mockAttestation } from "./test-kit";
import { CONNECT_TO_CHECK, NodeTrust, NOT_THE_SIGNER, NotSentError, UntrustedError } from "./trust";
import type { Verifier } from "./verifier";

const ENCLAVE = "0x00000000000000000000000000000000000000aa";
const CONFIG = `0x${"c0".repeat(32)}` as const;
const DIGEST = `0x${"1d".repeat(48)}` as const;
const RELEASE: PinnedRelease = { name: "test-release", launchDigest: DIGEST, policy: "0x30000", minimumTcb: { bootLoader: 3, tee: 0, snp: 8, microcode: 115 } };
const NAMED: VaultFacts = { release: releaseName(DIGEST, CONFIG), signer: ENCLAVE };
const HARDWARE = JSON.stringify({ provider: "sev_snp", config_sha256: CONFIG });
const READ_FAILED = "Your wallet could not read the vault's current release: no answer";
const CLOCK = "Your device clock differs from the node's signed time by 60 s. Correct the clock and reload.";

/** A hardware quote that verifies, so the vault's read alone decides the verdict; the mock path is the real verifier's. */
const verifier: Verifier = { ...dev, verifyAttestation: () => ({ ok: true, enclave: { address: ENCLAVE, release: RELEASE.name, config: "attested" } }) };

/** A `NodeTrust` over a node and a vault a test can change, judged once. */
async function judged(start: { vault?: VaultFacts | Error | null; attestation?: () => Promise<string> } = {}) {
  const held = { vault: start.vault === undefined ? NAMED : start.vault, attestation: start.attestation ?? (async () => HARDWARE) };
  const trust = new NodeTrust({
    attestation: () => held.attestation(), collateral: async () => "{}", verifier: async () => verifier, releases: [RELEASE], devDigests: [], acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => (held.vault === null ? null : held.vault instanceof Error ? Promise.reject(held.vault) : Promise.resolve(held.vault)),
    onStatus: () => {}, onEnclaveChanged: () => {},
  });
  await trust.verify();
  return { trust, held };
}

/** What the gate came to: the address it passed, or the refusal. */
const gate = (trust: NodeTrust): Promise<string | Error> => trust.sendingSigner().catch((error: unknown) => {
  if (error instanceof Error) return error;
  throw new Error("the gate threw something that is not an Error");
});

/** Asserts `trust` is refused for `reason`, as nothing having left the page rather than as an untrusted answer. */
async function refuses(trust: NodeTrust, reason: string) {
  const outcome = await gate(trust);
  expect(outcome).toBeInstanceOf(NotSentError);
  expect(outcome).not.toBeInstanceOf(UntrustedError);
  expect(outcome).toMatchObject({ message: `Nothing was sent. ${reason}` });
}

describe("the verdicts the last gate passes", () => {
  it("passes one the vault has judged, naming its enclave", async () => {
    const { trust } = await judged();
    expect(trust.status.kind).toBe("verified");
    await expect(gate(trust)).resolves.toBe(ENCLAVE);
  });

  it("passes a dev build's mock verdict, naming its enclave", async () => {
    const { trust } = await judged({ vault: null, attestation: async () => mockAttestation(ENCLAVE) });
    expect(trust.status.kind).toBe("mock");
    await expect(gate(trust)).resolves.toBe(ENCLAVE);
  });
});

describe("the verdicts the last gate refuses", () => {
  it("refuses an attested verdict, for no wallet to read the vault and for a read that failed", async () => {
    await refuses((await judged({ vault: null })).trust, CONNECT_TO_CHECK);
    await refuses((await judged({ vault: new Error("no answer") })).trust, READ_FAILED);
  });

  it("refuses a wrong clock over a verdict that could sign, and over one that could not, though both name an enclave", async () => {
    const verified = (await judged()).trust;
    verified.clockWrong(60_000);
    await refuses(verified, CLOCK);
    const attested = (await judged({ vault: null })).trust;
    attested.clockWrong(-60_000);
    await refuses(attested, CLOCK);
  });

  it("gives back what the verdict under the clock allowed once the clock agrees again", async () => {
    const verified = (await judged()).trust;
    verified.clockWrong(60_000);
    verified.clockRight();
    await expect(gate(verified)).resolves.toBe(ENCLAVE);
    const attested = (await judged({ vault: null })).trust;
    attested.clockWrong(60_000);
    attested.clockRight();
    await refuses(attested, CONNECT_TO_CHECK);
  });

  it("refuses a verdict that ended with the wallet open: a new vault signer, or a re-check that gave up on the vault", async () => {
    const replaced = await judged();
    replaced.held.vault = { ...NAMED, signer: "0x00000000000000000000000000000000000000ff" };
    await replaced.trust.verifyAfresh();
    expect(replaced.trust.status.kind).toBe("unverified");
    await refuses(replaced.trust, NOT_THE_SIGNER);
    const gaveUp = await judged();
    gaveUp.held.vault = new Error("no answer");
    await gaveUp.trust.verifyAfresh();
    await refuses(gaveUp.trust, READ_FAILED);
  });

  it("refuses a node that cannot be reached, as not sent, keeping the failure as the cause", async () => {
    const { trust, held } = await judged();
    held.attestation = async () => { throw new Error("offline"); };
    await trust.verifyAfresh();
    await refuses(trust, "offline");
    expect(await gate(trust)).toMatchObject({ cause: expect.any(UntrustedError) });
  });

  it("takes the verdict of a check still running, whichever way it goes", async () => {
    const { trust, held } = await judged();
    held.vault = null;
    const running = trust.verify();
    await refuses(trust, CONNECT_TO_CHECK);
    await running;
  });
});

describe("a signed action a live client's gate stops", () => {
  const order = { account: ENCLAVE } as unknown as Parameters<ReturnType<typeof setup>["client"]["placeOrder"]>[0]; // never read: the gate comes first
  const revocation = order as unknown as Parameters<ReturnType<typeof setup>["client"]["revokeSessionKey"]>[0];

  it("never reaches the node, by POST or DELETE, under an attestation that fails", async () => {
    const { node, client } = setup();
    node.routes.set("/v1/attestation", () => new Response("", { status: 503 }));
    await expect(client.verify()).resolves.toMatchObject({ kind: "unverified" });
    await expect(client.placeOrder(order)).rejects.toBeInstanceOf(NotSentError);
    await expect(client.revokeSessionKey(revocation)).rejects.toBeInstanceOf(NotSentError);
    expect(node.requests.filter((request) => request.path !== "/v1/attestation")).toEqual([]);
  });

  it("never reaches the node once a signed answer has shown the clock wrong", async () => {
    const { node, client } = setup({ nowMs: markets.time_ms + 60_000 });
    await expect(client.markets()).rejects.toBeInstanceOf(UntrustedError);
    await expect(client.placeOrder(order)).rejects.toThrow(`Nothing was sent. ${CLOCK}`);
    await expect(client.revokeSessionKey(revocation)).rejects.toThrow(`Nothing was sent. ${CLOCK}`);
    expect(node.requests.map((request) => request.path).filter((path) => path !== "/v1/attestation")).toEqual(["/v1/markets"]);
  });
});
