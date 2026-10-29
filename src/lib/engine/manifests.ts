/** The node release manifests (`release.toml`) this build trusts; the verifier names the one an attestation matches. */

// Empty until the engine publishes a release: the current and the previous manifest go here, so a
// node upgrade does not outrun the console that pins it.
export const RELEASE_MANIFESTS: readonly string[] = [];
