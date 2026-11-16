/**
 * Which enclave the vault names, as the node states it in `GET /v1/operator` (monkey-trading/console#280,
 * monkey-trading/engine#595): the signer epoch and the key. The highest epoch seen decides, so a node
 * that lags behind a promotion cannot pass as the signer the vault named before it, and the outgoing
 * operator's answers are refused once a node this client has read has said the vault names another
 * key. Each client keeps its own, so a node the console moves to starts from its own first check; the
 * operator follower puts to the client in use the highest signer other nodes' words named.
 */

/** A signer epoch and the key the vault names at it. */
export interface NamedSigner {
  epoch: number;
  address: string;
}

/** The highest signer epoch named and the key named at it; `address` is null once two keys were named at that epoch (monkey-trading/console#381). */
export type SignerFloor = { epoch: number; address: string | null };

/** What the node says of itself and the vault in `GET /v1/operator`. */
export interface OperatorClaim {
  /** The node's own enclave address. */
  enclave?: string;
  /** The vault's signer epoch and the key it names. */
  signer?: NamedSigner;
}

/** What `judge` weighs: a node's claim, or the highest signer another client heard, which may name two keys at its epoch. */
export type SignerWord = { enclave?: string; signer?: Readonly<SignerFloor> };

/** Why a check refuses a node for the signer the vault names, and whether a read of the vault naming its enclave would have taken it (`vaultLifts`). */
export type SignerRefusal = { reason: string; vaultLifts: boolean };

/** What the console says when the vault names a signer other than the enclave the node answers with. */
export const SIGNER_SUPERSEDED = "The on-chain vault that holds deposits now uses a different signing key from this server, so this server isn't trusted. Waiting won't fix this unless the server switches to the vault's key.";
/** What the console says when two keys were named as the vault's signer at the highest epoch seen: every key at it is refused, waiting helps only once a later epoch names one (monkey-trading/console#387). */
export const SIGNER_CONFLICT = "Two signing keys are listed as current, so this server isn't trusted for now. This clears by itself once the next key change names just one.";
/** What the console says when a node that states no signer has no read of the vault naming its enclave yet: a read of the vault lifts it (monkey-trading/console#387). */
export const SIGNER_AWAITING_VAULT = "This server doesn't say which signing key it uses, and it hasn't been checked against the on-chain vault that holds deposits yet. Connect a wallet to run that check.";
/** What the console says when the node's own word on the signer the vault names could not be read, before the read's failure. */
export const SIGNER_UNREAD = "Couldn't read which signing key this server uses, so it isn't trusted yet.";
/** The refusal reasons above as the clause a control names ("You can't sign right now because ..."), keyed by the reason (monkey-trading/console#387). */
const SIGNER_CLAUSES = new Map<string, string>([
  [SIGNER_SUPERSEDED, "the vault now uses a different signing key from this server"],
  [SIGNER_CONFLICT, "two signing keys are listed as current until the next key change names one"],
  [SIGNER_AWAITING_VAULT, "this server's signing key hasn't been checked against the vault yet"],
]);

/** The clause a control names for a refusal `reason`, or null when the reason is not one of these. */
export function signerClause(reason: string): string | null {
  return SIGNER_CLAUSES.get(reason) ?? null;
}

/** What the console says when a node's answer names an enclave other than the one that signed it. */
const WRONG_ENCLAVE = "The server's reply named a different signing key from the one that signed it, so the reply was ignored.";

/** `floor` raised by `named`: to it at a later epoch, to no key at the same epoch naming another, whichever was read first; `floor` itself otherwise. */
export function raised(floor: SignerFloor | null, named: Readonly<SignerFloor>): SignerFloor {
  const address = named.address?.toLowerCase() ?? null;
  if (floor === null || named.epoch > floor.epoch) return { epoch: named.epoch, address };
  return named.epoch === floor.epoch && floor.address !== null && address !== floor.address ? { epoch: floor.epoch, address: null } : floor;
}

export class SignerNaming {
  /** `operatorClaim` reads the node's own word, under an enclave just verified; absent where nothing can. `onRaised` hears each rise of the highest epoch seen, or a second key named at it, once the judgement that raised it is settled (monkey-trading/console#377, #381). */
  constructor(private readonly operatorClaim?: (address: string) => Promise<OperatorClaim>, private readonly onRaised: () => void = () => undefined) {}

  /** The highest epoch seen and the key the vault names at it, none once two were named at it. */
  private named: SignerFloor | null = null;
  /** Each key named at the highest epoch, or held since a word raised it: a word at a later epoch puts each aside but the key it names (monkey-trading/console#381). */
  private readonly keys = new Set<string>();
  /** Enclave addresses a stated signer has put aside, the key named at an earlier epoch among them, each with the reason: a node that attests one stays refused until the vault names it again at a later epoch. */
  private readonly superseded = new Map<string, string>();
  /** Those a read of the vault put aside: only a read of the vault that names one takes it back, never a word, which may be older than the read. */
  private readonly vaultRefused = new Set<string>();

  /**
   * Judges `answer`, which `trusted` (the verified enclave, null when none) signed: null when it stands, or the reason it is refused and
   * whether `trusted` is put aside. An answer is refused that names another enclave than the one that signed it; or whose enclave is not
   * the key at the highest epoch seen, whether that epoch is the answer's own or a node before it said a later one; or while two keys were
   * named for that epoch, until a later one names one.
   */
  judge(trusted: string | null, answer: SignerWord): { reason: string; supersede: boolean } | null {
    if (answer.enclave !== undefined && trusted !== null && answer.enclave.toLowerCase() !== trusted) return { reason: WRONG_ENCLAVE, supersede: false };
    if (answer.signer === undefined) return null;
    const before = this.named;
    const named = (this.named = raised(before, answer.signer));
    if (before === null || named.epoch > before.epoch) {
      // The keys named at the earlier epoch are no longer the vault's, whichever node says so.
      for (const key of this.keys) if (key !== named.address) this.superseded.set(key, SIGNER_SUPERSEDED);
      this.keys.clear();
      if (named.address !== null && !this.vaultRefused.has(named.address)) this.superseded.delete(named.address);
    }
    if (answer.signer.epoch === named.epoch) {
      if (answer.signer.address !== null) this.keys.add(answer.signer.address.toLowerCase());
      // No key named at an epoch two keys were named at stands on a word, its answers in flight included.
      if (named.address === null) for (const key of this.keys) this.superseded.set(key, SIGNER_CONFLICT);
    }
    const stands = trusted === null || trusted === named.address;
    const reason = named.address === null ? SIGNER_CONFLICT : SIGNER_SUPERSEDED;
    if (trusted !== null && !stands) this.superseded.set(trusted, reason);
    if (named !== before) this.onRaised();
    return stands ? null : { reason, supersede: true };
  }

  /**
   * Why a node that attested `address` is refused for the signer the vault names, or null: its own signed word on it is read before any
   * other answer is taken, so a node the vault no longer names is refused at the first check, not at the first operator read; an enclave
   * put aside earlier stays refused unless that word names it again at a later epoch, or, for one a read of the vault put aside, until a
   * read of the vault names it. A node that states none (one that predates the
   * route, which `operatorClaim` reads as nothing stated, or whose liveness rule does not run) is judged by what other reads have said:
   * it is refused, and put aside, while they name another key at the highest epoch seen, or two keys at it, unless this check's own read
   * of the vault named it (`vaultJudged`, monkey-trading/console#376). A word that cannot be read refuses the node: the next answer it is
   * asked for checks it again. A refusal past the node's own word with no read of the vault is one a read naming the enclave would have
   * lifted (`vaultLifts`, monkey-trading/console#379).
   */
  async refusal(address: string, vaultJudged: boolean): Promise<SignerRefusal | null> {
    let claim: OperatorClaim;
    try {
      claim = (await this.operatorClaim?.(address)) ?? {};
    } catch (error) {
      return { reason: `${SIGNER_UNREAD} ${error instanceof Error ? error.message : "The request failed."}`, vaultLifts: false };
    }
    const judged = this.judge(address, claim);
    if (judged !== null) return { reason: judged.reason, vaultLifts: false };
    const unnamed = claim.signer === undefined && !vaultJudged && this.named !== null && this.named.address !== address;
    if (!unnamed && !this.refuses(address)) return null;
    // An answer or a scan still in flight under it is refused too.
    // A node put aside for a reason keeps it: it is the more specific one.
    const reason = this.superseded.get(address) ?? (unnamed ? SIGNER_AWAITING_VAULT : SIGNER_SUPERSEDED);
    this.superseded.set(address, reason);
    return { reason, vaultLifts: !vaultJudged };
  }

  /** The vault itself, read through the wallet, names `signer`: an enclave it does not name is put aside until a read of the vault names it, and the one it does is taken back. */
  vaultSays(enclave: string, signer: string): void {
    if (enclave === signer) {
      this.superseded.delete(enclave);
      this.vaultRefused.delete(enclave);
    } else {
      this.superseded.set(enclave, SIGNER_SUPERSEDED);
      this.vaultRefused.add(enclave);
    }
  }

  /** Raises the highest epoch seen by `floor`, the highest word heard before this node was in use, without putting any key aside: later checks are held to it, while the enclave trusted now keeps its verdict (monkey-trading/console#376, #381). */
  hold(floor: Readonly<SignerFloor>): void {
    const before = this.named;
    this.named = raised(before, floor);
    // Kept for a word's later epoch to put aside.
    if (floor.address !== null && floor.epoch === this.named.epoch) this.keys.add(floor.address.toLowerCase());
    if (this.named !== before) this.onRaised();
  }

  /** The highest epoch seen and the key named at it, none once two were; null before any. */
  get highest(): Readonly<SignerFloor> | null {
    return this.named;
  }

  /** Why `enclave` was put aside, as the reason its answers are refused with. */
  why(enclave: string): string {
    return this.superseded.get(enclave) ?? SIGNER_SUPERSEDED;
  }

  /** Whether `enclave` has been put aside by a stated signer. */
  refuses(enclave: string): boolean {
    return this.superseded.has(enclave);
  }
}
