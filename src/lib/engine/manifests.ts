/**
 * The releases this build trusts: what no chain read can vouch for. A release's launch digest names
 * the code and its guest policy and minimum TCB are what a quote must also show; the launch digest
 * does not cover the policy (the engine's `image/README.md`). The vault's current release supplies
 * the operator's config, and must hash from one of these digests and the attested config.
 */

export interface PinnedRelease {
  /** The release's name, shown once a quote verifies against it. */
  name: string;
  /** The 48-byte SEV-SNP launch digest its image builds to, `measurement.json`'s `launch_digest`. */
  launchDigest: `0x${string}`;
  /** The guest policy it launches with, `measurement.json`'s `policy`. */
  policy: `0x${string}`;
  /** The lowest reported TCB a quote from it is accepted at. */
  minimumTcb: { bootLoader: number; tee: number; snp: number; microcode: number };
}

// Empty until the engine publishes a release: the current and the previous release go here, so a
// node upgrade does not outrun the console that pins it. Only the one the vault names is accepted.
export const PINNED_RELEASES: readonly PinnedRelease[] = [];
