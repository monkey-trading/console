/** Tests for how a pinned release and the vault's name for a release meet. */

import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";

import type { PinnedRelease } from "./manifests";
import { digestNamed, isConfigHash, manifestText, releaseName } from "./release-check";

const DIGEST = `0x${"5a".repeat(48)}` as const;
const CONFIG = `0x${"c0".repeat(32)}` as const;
const RELEASE: PinnedRelease = { name: "v1", launchDigest: DIGEST, policy: "0x30000", minimumTcb: { bootLoader: 1, tee: 2, snp: 8, microcode: 115 } };

describe("isConfigHash", () => {
  it("takes 0x and 64 lowercase hex digits, and nothing else the node could send", () => {
    expect(isConfigHash(CONFIG)).toBe(true);
    for (const hostile of [undefined, null, 7, "", CONFIG.slice(2), CONFIG.toUpperCase(), `${CONFIG}0`, `${CONFIG}"\n[config_hashes]\n"x" = "0x00`, `0x${"zz".repeat(32)}`]) {
      expect(isConfigHash(hostile), String(hostile)).toBe(false);
    }
  });
});

describe("releaseName", () => {
  it("hashes the digest and the config packed, as the vault names a release", () => {
    // keccak256(abi.encodePacked(launchDigest, configHash)), `Vault.setCurrentRelease`: 80 bytes, no length prefix.
    expect(releaseName(DIGEST, CONFIG)).toBe(keccak256(`0x${"5a".repeat(48)}${"c0".repeat(32)}`));
  });
});

describe("digestNamed", () => {
  const older: PinnedRelease = { ...RELEASE, name: "v0", launchDigest: `0x${"0d".repeat(48)}` };

  it("finds the pinned release the vault names, whatever case the chain read answered in", () => {
    expect(digestNamed([older, RELEASE], releaseName(DIGEST, CONFIG), CONFIG)).toBe(RELEASE);
    expect(digestNamed([older, RELEASE], releaseName(DIGEST, CONFIG).toUpperCase().replace("0X", "0x"), CONFIG)).toBe(RELEASE);
  });

  it("refuses an older pinned release while the vault names a newer one: the older code cannot hash to it", () => {
    expect(digestNamed([older], releaseName(DIGEST, CONFIG), CONFIG)).toBeNull();
  });

  it("refuses the pinned code under a config the vault does not name", () => {
    expect(digestNamed([RELEASE], releaseName(DIGEST, CONFIG), `0x${"c1".repeat(32)}`)).toBeNull();
  });

  it("finds nothing when the build pins nothing", () => {
    expect(digestNamed([], releaseName(DIGEST, CONFIG), CONFIG)).toBeNull();
  });
});

describe("manifestText", () => {
  it("writes the release manifest the verifier reads, with the attested config", () => {
    expect(manifestText(RELEASE, CONFIG)).toBe(`name = "v1"
launch_digest = "${DIGEST}"
policy = "0x30000"

[minimum_tcb]
boot_loader = 1
tee = 2
snp = 8
microcode = 115

[config_hashes]
"attested" = "${CONFIG}"
`);
  });
});
