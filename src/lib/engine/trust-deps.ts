/** What `NodeTrust` needs from the client: the node's attestation and collateral, the verifier, the releases the build pins, and the vault's and the node's own word on the signer. */

import type { AttestationStatus } from "./attestation";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import type { OperatorClaim } from "./signer-naming";
import type { Verifier } from "./verifier";

export interface TrustDeps {
  /** `GET /v1/attestation`, as text. */
  attestation(): Promise<string>;
  /** `GET /v1/attestation/collateral`, as text; null when the node has none (a mock quote). */
  collateral(): Promise<string | null>;
  /** The verifier, loaded on first use. */
  verifier(): Promise<Verifier>;
  /** The releases this build pins. */
  releases: readonly PinnedRelease[];
  /** A dev build's stand-ins for the launch digest a mock quote cannot measure; with none, its mock node is not checked against the vault. */
  devDigests: readonly string[];
  /** The vault's facts through the connected wallet, bounded in time; null with no wallet that reads a chain. */
  vaultFacts(): Promise<VaultFacts> | null;
  acceptsMock: boolean;
  nowMs(): number;
  onStatus(status: AttestationStatus): void;
  /** The verified enclave address changed from an earlier one. */
  onEnclaveChanged(): void;
  /** The node's own signed word on its enclave and the signer the vault names (`GET /v1/operator`), read under `address`, just verified and not yet trusted (monkey-trading/console#280): nothing stated from a node that predates the route; rejects when it cannot be read. */
  operatorClaim?(address: string): Promise<OperatorClaim>;
}
