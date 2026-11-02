/**
 * Whether an attested config runs a release the vault names: the vault names a release as
 * `keccak256(launchDigest ‖ configHash)` (`Vault.setCurrentRelease`, `OperatorRegistry._release`),
 * so the config comes from the chain's name for the release and the code from this build's pin. The
 * config hash is the node's own text until the verifier binds it to the quote, so nothing here
 * takes it before `isConfigHash` has.
 */

import { concatHex, keccak256, type Hex } from "viem";

import type { PinnedRelease } from "./manifests";

const CONFIG_HASH = /^0x[0-9a-f]{64}$/;

/** Whether `value` is a config hash as the attestation serves it: `0x` and 64 lowercase hex digits. */
export function isConfigHash(value: unknown): value is Hex {
  return typeof value === "string" && CONFIG_HASH.test(value);
}

/** The vault's name for a release. */
export function releaseName(launchDigest: Hex, configHash: Hex): Hex {
  return keccak256(concatHex([launchDigest, configHash]));
}

/** The first of `digests` that, with `configHash`, hashes to the release the vault names; null when none does. */
export function digestNamed<T extends { launchDigest: Hex }>(pinned: readonly T[], vaultRelease: string, configHash: Hex): T | null {
  const wanted = vaultRelease.toLowerCase();
  return pinned.find((release) => releaseName(release.launchDigest, configHash) === wanted) ?? null;
}

/**
 * The manifest text the verifier takes for `release` running `configHash`: the pinned code, policy
 * and TCB, and that one config. Both are checked against the quote, which binds the config hash
 * through its report data; the caller has passed `configHash` through `isConfigHash`, so it cannot
 * add a line to the text.
 */
export function manifestText(release: PinnedRelease, configHash: Hex): string {
  const { bootLoader, tee, snp, microcode } = release.minimumTcb;
  return [
    `name = ${JSON.stringify(release.name)}`,
    `launch_digest = "${release.launchDigest}"`,
    `policy = "${release.policy}"`,
    "",
    "[minimum_tcb]",
    `boot_loader = ${bootLoader}`,
    `tee = ${tee}`,
    `snp = ${snp}`,
    `microcode = ${microcode}`,
    "",
    "[config_hashes]",
    `"attested" = "${configHash}"`,
    "",
  ].join("\n");
}
