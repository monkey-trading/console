/** Which enclave address the console trusts the node's answers to come from, and how it got it. */

import type { AttestationStatus } from "./attestation";
import type { Verifier } from "./verifier";

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

const MOCK_REFUSED = "The node presents a mock attestation, which this build refuses.";
/** The messages the verifier gives when a certificate or list is outside its dates, which a wrong device clock also causes. */
const DATE_FAILURE = /validity period|not yet valid|is expired/;

export interface TrustDeps {
  /** `GET /v1/attestation`, as text. */
  attestation(): Promise<string>;
  /** `GET /v1/attestation/collateral`, as text; null when the node has none (a mock quote). */
  collateral(): Promise<string | null>;
  /** The verifier, loaded on first use. */
  verifier(): Promise<Verifier>;
  /** The release manifests this build pins. */
  manifests: readonly string[];
  acceptsMock: boolean;
  nowMs(): number;
  onStatus(status: AttestationStatus): void;
  /** The verified enclave address changed from an earlier one. */
  onEnclaveChanged(): void;
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
  /** The last address that was trusted, which a re-verification compares the next one with. */
  private lastSigner: string | null = null;

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
      // A node that failed its check stays shown as failed while the next attempt runs.
      if (this.verifiedStatus !== null) this.setStatus({ kind: "reverifying" });
      else if (this.current.kind !== "unverified") this.setStatus({ kind: "checking" });
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

  private trust(address: string): void {
    const changed = this.lastSigner !== null && this.lastSigner !== address;
    this.signerAddress = this.lastSigner = address;
    if (changed) this.deps.onEnclaveChanged();
  }

  private async run(): Promise<void> {
    this.signerAddress = null;
    this.verifiedStatus = null;
    try {
      const verifier = await this.deps.verifier();
      const text = await this.deps.attestation();
      const { provider } = JSON.parse(text) as { provider?: unknown };
      if (provider === "mock") {
        // Only the dev-only entry point reads a mock quote, and a build that refuses one never has it.
        if (!this.deps.acceptsMock || !verifier.verifyMockAttestation) return this.setStatus({ kind: "unverified", reason: MOCK_REFUSED });
        const mock = verifier.verifyMockAttestation(text);
        if (!mock.ok) return this.setStatus({ kind: "unverified", reason: mock.reason });
        this.trust(mock.enclave.address.toLowerCase());
        return this.setStatus({ kind: "mock" });
      }
      const collateral = await this.deps.collateral();
      if (collateral === null) return this.setStatus({ kind: "unverified", reason: "The node serves no collateral for its attestation, so it cannot be verified." });
      const verdict = verifier.verifyAttestation({ attestation: text, manifests: this.deps.manifests, collateral, nowMs: this.deps.nowMs() });
      if (!verdict.ok) {
        const hint = DATE_FAILURE.test(verdict.reason) ? " If the device clock is wrong, correct it and reload." : "";
        return this.setStatus({ kind: "unverified", reason: verdict.reason + hint });
      }
      const { address, release, config } = verdict.enclave;
      this.trust(address.toLowerCase());
      this.setStatus({ kind: "verified", release: release ?? "", config: config ?? "", address: address.toLowerCase() });
    } catch (error) {
      this.setStatus({ kind: "unverified", reason: error instanceof Error ? error.message : "The attestation could not be read." });
    }
  }
}
