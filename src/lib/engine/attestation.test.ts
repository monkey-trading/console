/** Tests for the attestation check that gates signing. */

import { describe, expect, it } from "vitest";

import { checkAttestation, maySign } from "./attestation";
import type { Attestation } from "./types";

const toHex = (text: string) => Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const base: Attestation = {
  provider: "mock", enclave_address: "0x1", config_sha256: "a", tls_public_key_sha256: "b", bundle: "c", report_data: "d",
  quote: toHex("MOCK-ATTESTATION-NOT-A-TEE:") + "00",
};

describe("checkAttestation", () => {
  it("accepts the node's mock quote in a mock build, and only that", () => {
    expect(checkAttestation(base)).toEqual({ kind: "mock" });
    expect(maySign(checkAttestation(base))).toBe(true);
  });

  it("refuses a mock provider without the marker and the marker under a hardware provider", () => {
    expect(checkAttestation({ ...base, quote: "00" }).kind).toBe("unverified");
    expect(checkAttestation({ ...base, provider: "sev_snp" }).kind).toBe("unverified");
  });

  it("refuses a hardware quote it cannot verify, and a malformed quote", () => {
    const status = checkAttestation({ ...base, provider: "sev_snp", quote: "ab".repeat(16) });
    expect(status).toMatchObject({ kind: "unverified" });
    expect(maySign(status)).toBe(false);
    expect(checkAttestation({ ...base, quote: "zz" }).kind).toBe("unverified");
    expect(maySign({ kind: "checking" })).toBe(false);
  });
});
