/** Which enclave address the console trusts the node's answers to come from, and how it got it. */

import { checkAttestation, type AttestationStatus } from "./attestation";
import type { Attestation } from "./types";
import type { Collateral, Verifier } from "./verifier";

/** Something the node sent cannot be trusted; the reason is written for the user. */
export class UntrustedError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = "UntrustedError";
  }
}

/** An answer whose signature does not verify under the trusted address: a forgery, a replay, or a restarted enclave. */
export class SignatureError extends UntrustedError {
  constructor(reason: string) {
    super(reason);
    this.name = "SignatureError";
  }
}

export interface TrustDeps {
  /** `GET /v1/attestation`. */
  attestation(): Promise<Attestation>;
  /** `GET /v1/attestation/collateral`; null when the node has none (a mock quote). */
  collateral(): Promise<Collateral | null>;
  verifier: Verifier;
  /** The release manifests this build pins. */
  manifests: readonly string[];
  acceptsMock: boolean;
  nowMs(): number;
  onStatus(status: AttestationStatus): void;
}

/**
 * Holds the verified enclave address. The first caller verifies the node's attestation and every
 * other caller waits for that; when an answer's signature fails, `recheck` verifies the node's
 * attestation again, since a restarted enclave signs with a new key, and nothing is trusted until
 * that finishes. Nothing here is persisted.
 */
export class NodeTrust {
  private signerAddress: string | null = null;
  private verifying: Promise<void> | null = null;
  private current: AttestationStatus = { kind: "checking" };
  /** The last status that trusted the node, which a clock disagreement hides and its resolution restores. */
  private verifiedStatus: AttestationStatus | null = null;

  constructor(private readonly deps: TrustDeps) {}

  get status(): AttestationStatus {
    return this.current;
  }

  /**
   * The enclave address to check answers against, verifying the node first when there is none.
   * Error cases:
   * - the node fails verification, or cannot be reached: `UntrustedError`
   */
  async signer(): Promise<string> {
    if (this.signerAddress === null || this.verifying !== null) await this.verify();
    if (this.signerAddress === null) throw new UntrustedError(this.current.kind === "unverified" ? this.current.reason : "The node is not verified.");
    return this.signerAddress;
  }

  /** Verifies the node's attestation now, or joins the check already running. */
  verify(): Promise<void> {
    if (this.verifying === null) {
      this.setStatus(this.verifiedStatus === null ? { kind: "checking" } : { kind: "reverifying" });
      this.verifying = this.run().finally(() => {
        this.verifying = null;
      });
    }
    return this.verifying;
  }

  /**
   * An answer failed to verify under `failed`. Verifies the node's attestation again and says
   * whether it now names another address; the caller may then retry once.
   */
  async recheck(failed: string): Promise<boolean> {
    this.signerAddress = null;
    await this.verify();
    return this.signerAddress !== null && this.signerAddress !== failed;
  }

  /** The device clock disagrees with the node's signed time by `skewMs`; nothing the node says can be judged. */
  clockWrong(skewMs: number): void {
    this.setStatus({ kind: "clock", skewMs });
  }

  /** The device clock agrees again after `clockWrong`. */
  clockRight(): void {
    if (this.current.kind === "clock") this.restore();
  }

  private restore(): void {
    this.setStatus(this.verifiedStatus ?? { kind: "checking" });
  }

  private setStatus(status: AttestationStatus): void {
    this.current = status;
    if (status.kind === "mock" || status.kind === "verified") this.verifiedStatus = status;
    this.deps.onStatus(status);
  }

  private async run(): Promise<void> {
    this.signerAddress = null;
    this.verifiedStatus = null;
    try {
      const attestation = await this.deps.attestation();
      const decided = checkAttestation(attestation, this.deps.acceptsMock);
      if (decided !== null) {
        if (decided.kind === "mock") this.signerAddress = attestation.enclave_address.toLowerCase();
        this.setStatus(decided);
        return;
      }
      const collateral = await this.deps.collateral();
      const verdict = await this.deps.verifier.verifyAttestation({ attestation, collateral, manifests: this.deps.manifests, nowMs: this.deps.nowMs() });
      if (!verdict.ok) {
        this.setStatus({ kind: "unverified", reason: verdict.reason });
        return;
      }
      const { address, release, config } = verdict.attested;
      this.signerAddress = address.toLowerCase();
      this.setStatus({ kind: "verified", release, config, address: this.signerAddress });
    } catch (error) {
      this.setStatus({ kind: "unverified", reason: error instanceof Error ? error.message : "The attestation could not be read." });
    }
  }
}
