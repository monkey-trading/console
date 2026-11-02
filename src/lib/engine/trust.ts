/** Which enclave address the console trusts the node's answers to come from, and how it got it. */

import type { Hex } from "viem";

import { MOCK_REFUSED, type AttestationStatus } from "./attestation";
import type { PinnedRelease } from "./manifests";
import type { VaultFacts } from "./registry";
import { digestNamed, isConfigHash, manifestText } from "./release-check";
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

/** How long a failure under an address that re-verified unchanged goes without another re-verification, in milliseconds. */
const RECHECK_COOLDOWN_MS = 30_000;
/** The messages the verifier gives when a certificate or list is outside its dates, which a wrong device clock also causes. */
const DATE_FAILURE = /validity period|not yet valid|is expired/;
/** What the console says when a quote is not for the release the vault names. */
export const NOT_NAMED = "The node does not run the release the vault names, or this console does not pin that release yet and needs updating.";
/** What the console says when the quote's enclave is not the one the vault pays out on. */
export const NOT_THE_SIGNER = "The node's enclave is not the signer the vault names.";
/** Why a quote that verified is not trusted to sign for: no wallet has read the vault. */
export const CONNECT_TO_CHECK = "Connect a wallet to check the vault's current release before anything is signed.";

/** What a read of the vault came to: no wallet to read it through, the facts, or the reason it failed. */
type VaultRead = { kind: "none" } | { kind: "read"; facts: VaultFacts } | { kind: "failed"; reason: string };

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
  /** The address whose last failed answer a re-verification did not explain, and when: it is not re-verified again for a while. */
  private suspect: { signer: string; at: number } | null = null;

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

  /**
   * The enclave address to send a signed request to. The last gate on one, whatever the screen
   * checked before it asked for a nonce: a check that ran since may have left the vault unread.
   * Error cases:
   * - as `signer`, or the node has not been checked against the vault: `UntrustedError`
   */
  async sendingSigner(): Promise<string> {
    const signer = await this.signer();
    if (this.current.kind === "attested") throw new UntrustedError(`Nothing was sent. ${this.current.why}`);
    return signer;
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

  /** Verifies the node's attestation on what is known now: a check already running may have read before a wallet arrived, so this runs after it rather than join it. */
  async verifyAfresh(): Promise<void> {
    await this.verifying;
    await this.verify();
  }

  /**
   * An answer failed to verify under `failed`. Verifies the node's attestation again and says
   * whether it now names another address; the caller may then retry once.
   */
  async recheck(failed: string): Promise<boolean> {
    const now = this.deps.nowMs();
    // A node that keeps failing under the same address is not asked for its attestation on every failure.
    if (this.suspect?.signer === failed && now - this.suspect.at < RECHECK_COOLDOWN_MS) return false;
    this.signerAddress = null;
    await this.verify();
    const changed = this.signerAddress !== null && this.signerAddress !== failed;
    this.suspect = changed ? null : { signer: failed, at: now };
    return changed;
  }

  /** Whether connecting a wallet changes this verdict: a quote the vault can judge, which a dev build's mock node with no stand-in digests is not. */
  get judgedByVault(): boolean {
    return this.current.kind !== "mock" || this.deps.devDigests.length > 0;
  }

  /** Whether the vault's `signer` calls for a new verdict: it is not the enclave trusted now, or the verdict was reached with no read of the vault. */
  outdatedBy(signer: string): boolean {
    if (!this.judgedByVault) return false;
    // A check running now may have read the vault before these facts.
    return this.verifying !== null || this.current.kind === "attested" || (this.signerAddress !== null && this.signerAddress !== signer);
  }

  /** The vault's read has answered after the check gave up on it: a verdict that went without it may now have it. */
  vaultAnsweredLate(): void {
    if (this.current.kind === "attested") void this.verify();
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
    if (status.kind === "mock" || status.kind === "verified" || status.kind === "attested") this.verifiedStatus = status;
    this.deps.onStatus(status);
  }

  private trust(address: string): void {
    const changed = this.lastSigner !== null && this.lastSigner !== address;
    this.signerAddress = this.lastSigner = address;
    if (changed) this.deps.onEnclaveChanged();
  }

  /** The vault's facts through the connected wallet; a failed read says why, and never counts as the vault's word. */
  private async readVault(): Promise<VaultRead> {
    const read = this.deps.vaultFacts();
    if (read === null) return { kind: "none" };
    try {
      return { kind: "read", facts: await read };
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.message : "the read failed" };
    }
  }

  /**
   * Why a dev build refuses its mock node, or null. With stand-in digests named, the mock node passes
   * the same two checks a hardware quote does once a wallet can read the vault; a mock quote proves
   * no enclave, so this exercises the path and vouches for nothing.
   */
  private async mockRefusal(configHash: unknown, address: string): Promise<string | null> {
    if (this.deps.devDigests.length === 0) return null;
    const vault = await this.readVault();
    if (vault.kind === "none") return null;
    if (vault.kind === "failed") return `Your wallet could not read the vault's current release: ${vault.reason}`;
    const digests = this.deps.devDigests.map((digest) => ({ launchDigest: digest as Hex })); // deploy.ts checked each is 0x hex
    if (!isConfigHash(configHash) || digestNamed(digests, vault.facts.release, configHash) === null) return NOT_NAMED;
    return address === vault.facts.signer ? null : NOT_THE_SIGNER;
  }

  private async run(): Promise<void> {
    this.signerAddress = null;
    this.verifiedStatus = null;
    try {
      const verifier = await this.deps.verifier();
      const text = await this.deps.attestation();
      // The node's own JSON: a body that is not an object has no provider, and the verifier then rejects it.
      const { provider, config_sha256: configHash } = (JSON.parse(text) ?? {}) as { provider?: unknown; config_sha256?: unknown };
      if (provider === "mock") {
        // Only the dev-only entry point reads a mock quote, and a build that refuses one never has it.
        if (!this.deps.acceptsMock || !verifier.verifyMockAttestation) return this.setStatus({ kind: "unverified", reason: MOCK_REFUSED });
        const mock = verifier.verifyMockAttestation(text);
        if (!mock.ok) return this.setStatus({ kind: "unverified", reason: mock.reason });
        const address = mock.enclave.address.toLowerCase();
        const refused = await this.mockRefusal(configHash, address);
        if (refused !== null) return this.setStatus({ kind: "unverified", reason: refused });
        this.trust(address);
        return this.setStatus({ kind: "mock" });
      }
      // The node's own text until the verifier binds it to the quote: checked first, so it cannot add a line to a manifest.
      if (!isConfigHash(configHash)) return this.setStatus({ kind: "unverified", reason: "The node's attestation names no configuration hash, so it cannot be verified." });
      const vault = await this.readVault();
      const pinned = vault.kind === "read" ? digestNamed(this.deps.releases, vault.facts.release, configHash) : null;
      if (vault.kind === "read" && pinned === null) return this.setStatus({ kind: "unverified", reason: NOT_NAMED });
      const manifests = (pinned === null ? this.deps.releases : [pinned]).map((release) => manifestText(release, configHash));
      const collateral = await this.deps.collateral();
      if (collateral === null) return this.setStatus({ kind: "unverified", reason: "The node serves no collateral for its attestation, so it cannot be verified." });
      const verdict = verifier.verifyAttestation({ attestation: text, manifests, collateral, nowMs: this.deps.nowMs() });
      if (!verdict.ok) {
        const hint = DATE_FAILURE.test(verdict.reason) ? ". If the device clock is wrong, correct it and reload." : "";
        return this.setStatus({ kind: "unverified", reason: verdict.reason + hint });
      }
      const address = verdict.enclave.address.toLowerCase();
      const { release, config } = verdict.enclave;
      if (vault.kind === "read" && address !== vault.facts.signer) return this.setStatus({ kind: "unverified", reason: NOT_THE_SIGNER });
      this.trust(address);
      if (vault.kind === "read") this.setStatus({ kind: "verified", release: release ?? "", config: config ?? "", address });
      else this.setStatus({ kind: "attested", release: release ?? "", address, why: vault.kind === "none" ? CONNECT_TO_CHECK : `Your wallet could not read the vault's current release: ${vault.reason}` });
    } catch (error) {
      this.setStatus({ kind: "unverified", reason: error instanceof Error ? error.message : "The attestation could not be read." });
    }
  }
}
