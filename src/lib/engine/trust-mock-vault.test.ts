/** Tests for a dev build's mock node under the vault's checks: the path a local stack exercises, which vouches for nothing but must refuse as a hardware quote would. */

import { describe, expect, it } from "vitest";

import { dev } from "./live-setup";
import type { VaultFacts } from "./registry";
import { releaseName } from "./release-check";
import { mockAttestation } from "./test-kit";
import { CONNECT_TO_CHECK, NodeTrust, NOT_NAMED, NOT_THE_SIGNER } from "./trust";

const ENCLAVE = "0x00000000000000000000000000000000000000aa";
const DIGEST = `0x${"5a".repeat(48)}` as const;
/** The config hash `mockAttestation` serves. */
const CONFIG = `0x${"01".repeat(32)}` as const;

async function judge(devDigests: readonly string[], vault: VaultFacts | Error | null) {
  let reads = 0;
  const trust = new NodeTrust({
    attestation: async () => mockAttestation(ENCLAVE), collateral: async () => null, verifier: async () => dev, releases: [], devDigests, acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => {
      if (vault === null) return null;
      reads += 1;
      return vault instanceof Error ? Promise.reject(vault) : Promise.resolve(vault);
    },
    onStatus: () => {}, onEnclaveChanged: () => {},
  });
  await trust.verify();
  return { status: trust.status, reads, judged: trust.judgedByVault };
}

describe("a dev build's mock node", () => {
  it("is not read against the vault with no stand-in digests, as the ordinary local stack runs", async () => {
    expect(await judge([], { release: "0x", signer: "0x" })).toEqual({ status: { kind: "mock" }, reads: 0, judged: false });
  });

  it("is accepted with no wallet to read the vault, as any dev build's mock is", async () => {
    expect(await judge([DIGEST], null)).toMatchObject({ status: { kind: "mock" }, reads: 0, judged: true });
  });

  it("passes when its config hashes to the vault's release under a stand-in digest, from the vault's signer", async () => {
    expect(await judge([DIGEST], { release: releaseName(DIGEST, CONFIG), signer: ENCLAVE })).toMatchObject({ status: { kind: "mock" }, reads: 1 });
  });

  it("refuses a release the vault does not name, an enclave it does not name, and a failed read", async () => {
    expect((await judge([DIGEST], { release: `0x${"ee".repeat(32)}`, signer: ENCLAVE })).status).toEqual({ kind: "unverified", reason: NOT_NAMED });
    expect((await judge([DIGEST], { release: releaseName(DIGEST, CONFIG), signer: "0xff" })).status).toEqual({ kind: "unverified", reason: NOT_THE_SIGNER });
    expect((await judge([DIGEST], new Error("no answer"))).status).toEqual({ kind: "unverified", reason: "Your wallet could not read the vault's current release: no answer" });
    expect(CONNECT_TO_CHECK).toContain("vault");
  });
});
