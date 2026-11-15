/**
 * Which enclave the vault names, as the node states it in `GET /v1/operator` (monkey-trading/console#280,
 * monkey-trading/engine#595): the signer epoch and the key. The highest epoch seen decides, so a node
 * that lags behind a promotion cannot pass as the signer the vault named before it, and the outgoing
 * operator's answers are refused once any node has said the vault names another key.
 */

/** What the node says of itself and the vault in `GET /v1/operator`. */
export interface OperatorClaim {
  /** The node's own enclave address. */
  enclave?: string;
  /** The vault's signer epoch and the key it names. */
  signer?: { epoch: number; address: string };
}

/** What the console says when the vault names a signer other than the enclave the node answers with. */
export const SIGNER_SUPERSEDED = "The vault names another signer than this node's enclave, so the node's answers are refused.";
/** What the console says when a node's answer names an enclave other than the one that signed it. */
const WRONG_ENCLAVE = "The node named an enclave other than the one that signed its answer, so the answer was discarded.";

export class SignerNaming {
  /** The highest epoch seen and the key the vault names at it. */
  private named: { epoch: number; address: string } | null = null;
  /** Enclave addresses a stated signer has put aside: a node that attests one stays refused until the vault names it again at a later epoch. */
  private readonly superseded = new Set<string>();

  /**
   * Judges `answer`, which `trusted` (the verified enclave, null when none) signed: null when it stands, or the reason it is refused and
   * whether `trusted` is put aside. An answer is refused that names another enclave than the one that signed it; or whose enclave is not
   * the key at the highest epoch seen, whether that epoch is the answer's own or a node before it said a later one; or that names two
   * keys for one epoch.
   */
  judge(trusted: string | null, answer: OperatorClaim): { reason: string; supersede: boolean } | null {
    if (answer.enclave !== undefined && trusted !== null && answer.enclave.toLowerCase() !== trusted) return { reason: WRONG_ENCLAVE, supersede: false };
    const claim = answer.signer;
    if (claim === undefined) return null;
    const address = claim.address.toLowerCase();
    const conflict = this.named !== null && claim.epoch === this.named.epoch && address !== this.named.address;
    if (this.named === null || claim.epoch > this.named.epoch) {
      this.named = { epoch: claim.epoch, address };
      this.superseded.delete(address);
    }
    if (trusted === null) return null;
    if (!conflict && this.named !== null && trusted === this.named.address) return null;
    this.superseded.add(trusted);
    return { reason: SIGNER_SUPERSEDED, supersede: true };
  }

  /** Whether `enclave` has been put aside by a stated signer. */
  refuses(enclave: string): boolean {
    return this.superseded.has(enclave);
  }
}
