/** Which enclave address the console trusts the node's answers to come from, and how it got it. */

import type { Hex } from "viem";

import { MOCK_REFUSED, type AttestationStatus } from "./attestation";
import type { TrustDeps } from "./trust-deps";
import { readVault } from "./trust-vault";
import { SignerNaming, type SignerFloor, type SignerRefusal, type SignerWord } from "./signer-naming";
import { digestNamed, isConfigHash, manifestText } from "./release-check";

export { NotSentError, SignatureError, UntrustedError } from "./trust-errors";
import { NotSentError, sendRefusal, UntrustedError } from "./trust-errors";

/** How long a failure under an address that re-verified unchanged goes without another re-verification, in milliseconds. */
const RECHECK_COOLDOWN_MS = 30_000;
/** The messages the verifier gives when a certificate or list is outside its dates, which a wrong device clock also causes. */
const DATE_FAILURE = /validity period|not yet valid|is expired/;
/** What the console says when a quote is not for the release the vault names. */
export const NOT_NAMED = "This server isn't running the software version the vault expects, or this version of the app doesn't know that version yet and needs updating.";
/** What the console says when the quote's enclave is not the one the vault pays out on. */
export const NOT_THE_SIGNER = "This server's signing key isn't the one the vault uses.";
export { CONNECT_TO_CHECK } from "./trust-errors";
import { CONNECT_TO_CHECK } from "./trust-errors";

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
  /** Whether the vault judges the enclave trusted last: a dev build's mock node with no stand-in digests it does not. */
  private lastJudged = false;
  /** How many reads of the vault's word have been taken: a check's own read stands only while no newer one came. */
  private vaultHeard = 0;
  /** Whether the verdict now is a refusal a read of the vault naming the enclave would lift, so a read that comes later decides again (monkey-trading/console#379). */
  private vaultLifts = false;
  /** The address whose last failed answer a re-verification did not explain, and when: it is not re-verified again for a while. */
  private suspect: { signer: string; at: number } | null = null;
  /** The signer the node says the vault names (monkey-trading/console#280). */
  private readonly naming: SignerNaming;

  constructor(private readonly deps: TrustDeps) { this.naming = new SignerNaming(deps.operatorClaim, () => deps.onSignerNamed?.()); }

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
    if (this.signerAddress === null) throw new UntrustedError(sendRefusal(this.current) ?? "The server hasn't been verified yet.");
    return this.signerAddress;
  }

  /**
   * The enclave address to send a signed request to. The last gate on one, whatever the screen
   * checked before it asked for a nonce: a check that ran since may have left the vault unread, ended
   * in a refusal, or met a wrong clock. Only a `verified` or `mock` verdict passes.
   * Error cases:
   * - any other verdict, or a node that fails verification or cannot be reached: `NotSentError`, since nothing has left the page
   */
  async sendingSigner(): Promise<string> {
    let signer: string;
    try {
      signer = await this.signer();
      // A check queued behind the one `signer` waited for may have started as it resumed: its verdict, not the last one's, decides.
      while (this.verifying !== null) signer = await this.signer();
    } catch (error) {
      throw new NotSentError(error instanceof Error ? error.message : "The server hasn't been verified yet.", { cause: error });
    }
    const refused = sendRefusal(this.current);
    if (refused !== null) throw new NotSentError(refused);
    return signer;
  }

  /** Verifies the node's attestation now, or joins the check already running. */
  verify(): Promise<void> {
    if (this.verifying === null) {
      // A node that failed its check, on the device clock included, stays shown as failed while the next attempt runs.
      if (this.verifiedStatus !== null) this.setStatus({ kind: "reverifying" });
      else if (this.current.kind !== "unverified" && this.current.kind !== "clock") this.setStatus({ kind: "checking" });
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

  /**
   * The node's `GET /v1/operator` stated the signer the vault names and its own enclave (`SignerNaming.judge`), in an answer the enclave
   * trusted last signed, a check running since or not. An answer that contradicts that enclave, or the highest signer seen, refuses the
   * enclave until the vault names it again, and ends the verdict and stops an open stream while it is trusted.
   * Error cases:
   * - the answer is refused: `UntrustedError`
   */
  heedOperator(answer: SignerWord): void {
    const refused = this.judged(answer);
    if (refused !== null) throw new UntrustedError(refused);
  }

  /** Another node's signed word names `signer`, or two keys at its epoch (monkey-trading/console#374, #381), judged as the node's own word is: the enclave trusted now loses its verdict, read-only or not, if the key named at the highest epoch is not it. */
  heedSigner(signer: Readonly<SignerFloor>): void {
    this.judged({ signer });
  }

  /**
   * The highest signer the visit heard before this node was in use, or two keys at its epoch (monkey-trading/console#376, #381): later checks of
   * the node are judged against it as against the node's own word, while the enclave trusted now keeps the verdict its own check reached, the wallet's vault read included.
   */
  holdSigner(floor: Readonly<SignerFloor>): void {
    this.naming.hold(floor);
  }

  /** The highest signer epoch named by this node's signed word or by another node's put to it, with the key named at it, none once two were; null before one was. */
  get signerNamed(): Readonly<SignerFloor> | null {
    return this.naming.highest;
  }

  /** Why `answer` is refused, or null; a refusal that puts the trusted enclave aside ends its verdict. */
  private judged(answer: SignerWord): string | null {
    const refusal = this.naming.judge(this.signerAddress ?? this.lastSigner, answer);
    if (refusal?.supersede === true && this.signerAddress !== null) {
      this.signerAddress = null;
      this.setStatus({ kind: "unverified", reason: refusal.reason });
    }
    return refusal?.reason ?? null;
  }

  /** Whether connecting a wallet changes this verdict: a quote the vault can judge, which a dev build's mock node with no stand-in digests is not. */
  get judgedByVault(): boolean {
    return this.current.kind !== "mock" || this.deps.devDigests.length > 0;
  }

  /** The vault, read through the wallet elsewhere, names `signer`: the enclave trusted last is put aside at once if it is not that key, whatever the verdict now, and a verdict the read outdates is reached again. */
  async heedVault(signer: string): Promise<void> {
    this.vaultNames(signer);
    if (this.outdatedBy(signer)) await this.verifyAfresh();
  }

  /** Whether the vault's `signer` calls for a new verdict: it is not the enclave trusted now, or the verdict was reached with no read of the vault, a refusal one would have lifted included. */
  private outdatedBy(signer: string): boolean {
    if (!this.judgedByVault) return false;
    // A check running now may have read the vault before these facts.
    return this.verifying !== null || this.current.kind === "attested" || this.vaultLifts || (this.signerAddress !== null && this.signerAddress !== signer);
  }

  /** The vault's read has answered after the check gave up on it: a verdict that went without it may now have it. */
  vaultAnsweredLate(): void {
    if (this.verifying !== null || this.current.kind === "attested" || this.vaultLifts) void this.verifyAfresh();
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

  private setStatus(status: AttestationStatus, vaultLifts = false): void {
    this.current = status;
    this.vaultLifts = vaultLifts;
    if (status.kind === "mock" || status.kind === "verified" || status.kind === "attested") this.verifiedStatus = status;
    this.deps.onStatus(status);
  }

  /** Ends a check on `refusal`, unless its own read of the node's word found the device clock wrong (a verdict other than `earlier`): that says more, and stays. */
  private refused(refusal: SignerRefusal, earlier: AttestationStatus): void {
    if (this.current.kind !== "clock" || this.current === earlier) this.setStatus({ kind: "unverified", reason: refusal.reason }, refusal.vaultLifts);
  }

  private trust(address: string, judged: boolean): void {
    const changed = this.lastSigner !== null && this.lastSigner !== address;
    this.signerAddress = this.lastSigner = address;
    this.lastJudged = judged;
    if (changed) this.deps.onEnclaveChanged();
  }

  /**
   * The vault names `signer`: the enclave trusted last, if the vault judges it, is put aside when it is not that key, before any check
   * that follows can fail, so an answer still in flight under it is refused. Returns the count of the vault's word this read is.
   */
  private vaultNames(signer: string): number {
    if (this.lastSigner !== null && this.lastJudged && this.lastSigner !== signer) this.naming.vaultSays(this.lastSigner, signer);
    return ++this.vaultHeard;
  }

  /** Whether a signer's answers are refused: another signer was named since it was verified. */
  refuses = (signer: string): boolean => this.naming.refuses(signer);

  /** Why a signer's answers are refused, as the error that refuses them says it. */
  whyRefused = (signer: string): string => this.naming.why(signer);

  /**
   * Why a dev build refuses its mock node, or whether the vault judged it. With stand-in digests named, the mock node passes
   * the same two checks a hardware quote does once a wallet can read the vault; a mock quote proves
   * no enclave, so this exercises the path and vouches for nothing.
   */
  private async mockRefusal(configHash: unknown, address: string): Promise<{ refused: string; vaultLifts?: true } | { judged: boolean }> {
    if (this.deps.devDigests.length === 0) return { judged: false };
    const vault = await readVault(this.deps.vaultFacts());
    if (vault.kind === "none") return { judged: false };
    if (vault.kind === "failed") return { refused: `Your wallet couldn't check this server against the vault: ${vault.reason}`, vaultLifts: true };
    this.vaultNames(vault.facts.signer);
    const digests = this.deps.devDigests.map((digest) => ({ launchDigest: digest as Hex })); // deploy.ts checked each is 0x hex
    if (!isConfigHash(configHash) || digestNamed(digests, vault.facts.release, configHash) === null) return { refused: NOT_NAMED };
    this.naming.vaultSays(address, vault.facts.signer);
    return address === vault.facts.signer ? { judged: true } : { refused: NOT_THE_SIGNER };
  }

  private async run(): Promise<void> {
    const earlier = this.current; // a clock verdict a check before this one reached, which a retry keeps shown
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
        const byVault = await this.mockRefusal(configHash, address);
        if ("refused" in byVault) return this.setStatus({ kind: "unverified", reason: byVault.refused }, byVault.vaultLifts === true);
        const superseded = await this.naming.refusal(address, byVault.judged);
        if (superseded !== null) return this.refused({ ...superseded, vaultLifts: superseded.vaultLifts && this.deps.devDigests.length > 0 }, earlier); // with no stand-in digests no read of the vault judges it
        this.trust(address, this.deps.devDigests.length > 0);
        return this.setStatus({ kind: "mock" });
      }
      // The node's own text until the verifier binds it to the quote: checked first, so it cannot add a line to a manifest.
      if (!isConfigHash(configHash)) return this.setStatus({ kind: "unverified", reason: "This server's verification data is incomplete, so it can't be verified." });
      const vault = await readVault(this.deps.vaultFacts());
      const heard = vault.kind === "read" ? this.vaultNames(vault.facts.signer) : 0;
      const pinned = vault.kind === "read" ? digestNamed(this.deps.releases, vault.facts.release, configHash) : null;
      if (vault.kind === "read" && pinned === null) return this.setStatus({ kind: "unverified", reason: NOT_NAMED });
      const manifests = (pinned === null ? this.deps.releases : [pinned]).map((release) => manifestText(release, configHash));
      const collateral = await this.deps.collateral();
      if (collateral === null) return this.setStatus({ kind: "unverified", reason: "This server didn't provide the certificates needed to verify it." });
      const verdict = verifier.verifyAttestation({ attestation: text, manifests, collateral, nowMs: this.deps.nowMs() });
      if (!verdict.ok) {
        const hint = DATE_FAILURE.test(verdict.reason) ? ". If your device clock is wrong, correct it and reload the page." : "";
        return this.setStatus({ kind: "unverified", reason: verdict.reason + hint });
      }
      const address = verdict.enclave.address.toLowerCase();
      const { release, config } = verdict.enclave;
      // A newer read of the vault, taken while this check waited on the node, decides over this one's.
      if (vault.kind === "read" && heard === this.vaultHeard) this.naming.vaultSays(address, vault.facts.signer);
      if (vault.kind === "read" && address !== vault.facts.signer) return this.setStatus({ kind: "unverified", reason: NOT_THE_SIGNER });
      const superseded = await this.naming.refusal(address, vault.kind === "read");
      if (superseded !== null) return this.refused(superseded, earlier);
      this.trust(address, true);
      if (vault.kind === "read") this.setStatus({ kind: "verified", release: release ?? "", config: config ?? "", address });
      else this.setStatus({ kind: "attested", release: release ?? "", address, why: vault.kind === "none" ? CONNECT_TO_CHECK : `Your wallet couldn't check this server against the vault: ${vault.reason}` });
    } catch (error) {
      this.setStatus({ kind: "unverified", reason: error instanceof Error ? error.message : "This server's verification data couldn't be read." });
    }
  }
}
