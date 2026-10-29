/** Tests for the attestation check that gates signing. */

import { describe, expect, it } from "vitest";

import { checkAttestation, maySign, signBlock } from "./attestation";
import type { Attestation } from "./types";

const toHex = (text: string) => Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const base: Attestation = {
  provider: "mock", enclave_address: "0x1", config_sha256: "a", tls_public_key_sha256: "b", bundle: "c", report_data: "d",
  quote: toHex("MOCK-ATTESTATION-NOT-A-TEE:") + "00",
};

describe("checkAttestation", () => {
  it("accepts the node's mock quote where the build allows it, with or without a 0x prefix", () => {
    expect(checkAttestation(base, true)).toEqual({ kind: "mock" });
    expect(checkAttestation({ ...base, quote: `0x${base.quote}` }, true)).toEqual({ kind: "mock" });
  });

  it("refuses a mock quote in a production build", () => {
    expect(checkAttestation(base, false)).toEqual({ kind: "unverified", reason: "The node presents a mock attestation, which this build refuses." });
    expect(checkAttestation({ ...base, quote: `0x${base.quote}` }, false)?.kind).toBe("unverified");
  });

  it("refuses a mock provider without the marker and the marker under a hardware provider", () => {
    expect(checkAttestation({ ...base, quote: "00" }, true)?.kind).toBe("unverified");
    expect(checkAttestation({ ...base, provider: "sev_snp" }, true)?.kind).toBe("unverified");
  });

  it("leaves a hardware quote, and a malformed one under a hardware provider, to the verifier", () => {
    expect(checkAttestation({ ...base, provider: "sev_snp", quote: "ab".repeat(16) }, true)).toBeNull();
    expect(checkAttestation({ ...base, provider: "sev_snp", quote: "zz" }, false)).toBeNull();
    expect(checkAttestation({ ...base, quote: "zz" }, true)?.kind).toBe("unverified");
  });
});

describe("maySign", () => {
  it("signs only for an attested node whose feed is arriving", () => {
    const verified = { kind: "verified", release: "r", config: "c", address: "0x1" } as const;
    expect(maySign({ kind: "mock" }, "live")).toBe(true);
    expect(maySign(verified, "live")).toBe(true);
    for (const status of [{ kind: "checking" }, { kind: "reverifying" }, { kind: "clock", skewMs: 60_000 }, { kind: "unverified", reason: "x" }] as const) {
      expect(maySign(status, "live")).toBe(false);
    }
    expect(maySign(verified, "stale")).toBe(false);
    expect(maySign(verified, "connecting")).toBe(false);
  });

  it("says why it may not", () => {
    expect(signBlock({ kind: "mock" }, "stale")).toContain("stale");
    expect(signBlock({ kind: "checking" }, "live")).toContain("attestation");
    expect(signBlock({ kind: "mock" }, "live")).toBeNull();
  });

  it("names a read-only account first, whatever else blocks", () => {
    expect(signBlock({ kind: "mock" }, "live", true)).toContain("read-only");
    expect(signBlock({ kind: "checking" }, "stale", true)).toContain("read-only");
    expect(maySign({ kind: "mock" }, "live")).toBe(true);
  });
});
