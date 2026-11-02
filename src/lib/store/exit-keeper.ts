/**
 * Brings the connected account's saved exit proof up to the vault's latest root, from what the vault
 * was last read to say. The route answers at the node's newest checkpoint only, which is the vault's
 * latest for most of each cycle (monkey-trading/engine#469). So a proof is kept only when its root is
 * the vault's latest and the vault's own `ExitVerifier` accepts it; anything else leaves the last
 * verified proof in place.
 */

import { ExitProofError, exitProofAccount, parseExitProof } from "../engine/exit-proof";
import { preferredRecord, readStoredExit, removeStoredExit, type ExitRecord, type ExitScope, type ExitStorage } from "../engine/exit-file";
import type { ExitProof, ExitWallet } from "../engine/exit-types";
import type { Wallet } from "../engine/wallet";
import { ExitAdopter } from "./exit-adopt";
import { heldSince, holdsNow, mayHold, newestEventSeq, nodeWait, stakeKey, type AdoptOutcome, type ExitState } from "./exit-state";
import { errorText } from "./signing";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

export class ExitKeeper {
  /** The vault root the node was last read for: a root it answered for is read once, and a read that failed is made again by itself. */
  private triedRoot: string | null = null;
  /** The `stakeKey` of the last answer that held nothing and covered everything the account had done. */
  private emptyKey: string | null = null;
  /** The node's answer the wallet could not check yet: the next read of the vault tries it, with no new signature. */
  private answer: ExitProof | null = null;
  /** The node's empty answer at a time the account's history had not landed. */
  private emptyAnswer: ExitProof | null = null;
  /** Holds each proof to the vault's own check. */
  readonly adopter: ExitAdopter;
  /** Whether the account has a distribution, once the node has said, for a connection with nothing else to go on. */
  private distributed: boolean | null = null;
  /** What a move from another node's store brought with it. */
  private carried: (Pick<ExitState, "record" | "storageProblem"> & { answer: ExitProof | null }) | null = null;
  private settling = false;
  private settleAgain = false;

  constructor(private readonly store: ConsoleStore) {
    this.adopter = new ExitAdopter(store);
  }

  private get storage(): () => ExitStorage | null {
    return this.store.deps.exitStorage ?? (() => null);
  }

  private patch(partial: Partial<ExitState>): void {
    this.store.patch({ exit: { ...this.store.getSnapshot().exit, ...partial } });
  }

  private work<T>(wallet: Wallet, task: () => Promise<T>): Promise<T> {
    return this.store.monkeySession.walletWork.work(wallet, task);
  }

  /** The connected account's place in storage, for a wallet that reads a chain. */
  scope(wallet: Wallet | null): ExitScope | null {
    if (wallet === null || wallet.exit === undefined) return null;
    const { chainId, vault } = this.store.deps.client.deployment;
    return { chainId, vault: vault.toLowerCase(), account: wallet.address.toLowerCase() };
  }

  /** Forgets what was tried for the last connection. */
  reset(): void {
    this.triedRoot = null;
    this.emptyKey = null;
    this.answer = null;
    this.emptyAnswer = null;
    this.distributed = null;
  }

  /** Lets a read of the node that failed be made again; one that answered costs a signature, and is not. */
  retryNode(): void {
    if (this.store.getSnapshot().exit.attempt?.kind === "node-failed") this.triedRoot = null;
  }

  /** A node behind the vault may have caught up, so each read of the vault asks it again. */
  retryBehind(): void {
    if (this.store.getSnapshot().exit.attempt?.kind === "node-behind") this.triedRoot = null;
  }

  /** Lets the node be read again for the root it was last read for: it was away, and may answer what it could not. An answer it gave already stays, which costs no signature to check. */
  forgetTried(): void {
    this.triedRoot = null;
    this.distributed = null; // a stake may have come and gone while it was away
  }

  /** Takes on what a store this one replaces held, for a connection about to be made here. */
  carry(exit: ExitState, from: ExitKeeper): void {
    this.carried = exit.record === null && from.answer === null ? null : { record: exit.record, storageProblem: exit.storageProblem, answer: from.answer };
  }

  /** What a connection just made starts from: what is saved for `scope`, or what a move brought, the later of them. */
  startingFrom(scope: ExitScope | null): Pick<ExitState, "record" | "storageProblem"> {
    const carried = this.carried;
    this.carried = null;
    if (scope === null) return { record: null, storageProblem: null };
    const stored = readStoredExit(this.storage, scope);
    const answer = carried?.answer ?? null;
    if (answer !== null && (exitProofAccount(answer) ?? scope.account) === scope.account) this.answer = answer;
    const brought = carried?.record ?? null;
    const held = brought === null || brought.account !== scope.account || brought.chainId !== scope.chainId || brought.vault !== scope.vault ? null : brought;
    if (held !== null && (stored.record === null || held.proof.seq > stored.record.proof.seq)) return { record: held, storageProblem: stored.problem ?? carried?.storageProblem ?? null };
    return { record: stored.record, storageProblem: stored.problem };
  }

  /** Runs the work below, and again if it was asked for while it ran. */
  async settle(): Promise<void> {
    if (this.settling) {
      this.settleAgain = true;
      return;
    }
    this.settling = true;
    try {
      do {
        this.settleAgain = false;
        await this.bringUp();
        this.noteMissing();
      } while (this.settleAgain);
    } finally {
      this.settling = false;
    }
  }

  /** Marks how long the account has had no proof at the vault's latest root, which every page says once it has lasted: since this page first saw so, or since the funds its reads show, whichever is earlier. */
  private noteMissing(): void {
    const state = this.store.getSnapshot();
    const { vault, record, nothing, missingSince } = state.exit;
    if (vault === null || !vault.hasCheckpoint || record?.proof.root === vault.latestRoot || nothing) {
      if (missingSince !== null) this.patch({ missingSince: null });
      return;
    }
    const since = Math.min(missingSince ?? vault.chainNow, heldSince(state) ?? vault.chainNow);
    if (since !== missingSince) this.patch({ missingSince: since });
  }

  /** Brings the saved proof up to the vault's latest root if the node can and it is worth a signature; whatever else happens, the last verified proof stays. */
  private async bringUp(): Promise<void> {
    const wallet = this.store.liveWallet;
    const exit = wallet?.exit;
    const scope = this.scope(wallet);
    const state = this.store.getSnapshot();
    const { vault } = state.exit;
    if (wallet === null || exit === undefined || scope === null || vault === null || !vault.hasCheckpoint) return;
    const stored = readStoredExit(this.storage, scope);
    let record = preferredRecord(stored.record, state.exit.record, vault.latestRoot);
    const storageProblem = stored.problem ?? state.exit.storageProblem;
    if (record !== state.exit.record || storageProblem !== state.exit.storageProblem) this.patch({ record, storageProblem });
    if (record?.proof.root === vault.latestRoot) {
      const standing = await this.adopter.checkSaved(wallet, exit, scope, record, vault);
      if (standing !== "refused") return;
      record = null;
    }
    // An answer that held nothing says nothing of what has been credited since: the next root may hold it.
    if (state.exit.nothing && holdsNow(state)) this.patch({ nothing: false, attempt: { kind: "not-covered" } });
    if (this.emptyAnswer !== null && state.accountHistory === "read") {
      const answer = this.emptyAnswer;
      this.emptyAnswer = null;
      if (answer.root === vault.latestRoot) this.heldNothing(this.store.getSnapshot(), scope, answer);
    }
    if (this.triedRoot === vault.latestRoot) return;
    const wait = nodeWait(state.attestation, state.stream);
    if (wait === "wait") return;
    if (wait !== "ready") {
      // That the vault refused what this browser had saved says more than that the node is away.
      if (this.store.getSnapshot().exit.attempt?.kind !== "saved-refused") this.patch({ attempt: { kind: "node-away", reason: wait.away } });
      return;
    }
    if (!state.accountRead || (!holdsNow(state) && state.accountHistory === "waiting")) return; // its read is under way, and hearing it brings this back
    // Once the exit has started, only the root's terms can show a deposit of this account's among the gaps they name, which nothing the page has read shows.
    const termsOwed = vault.exitStartedAt !== 0 && state.exit.terms?.root !== vault.latestRoot;
    if (!termsOwed && !holdsNow(state) && (await this.hasNothing(wallet, exit, record))) return;
    if (this.store.liveWallet === wallet) await this.readNode(wallet, scope, vault.latestRoot);
  }

  /** Whether the account shows nothing the node could prove, in which case the page says so and the node is not read. True too when a read this asks for failed, which it reports. */
  private async hasNothing(wallet: Wallet, exit: ExitWallet, record: ExitRecord | null): Promise<boolean> {
    try {
      const staked = await this.work(wallet, () => exit.stakeHeld());
      if (this.store.liveWallet !== wallet) return true;
      if (staked) return false;
    } catch (error) {
      if (this.store.liveWallet === wallet) this.patch({ attempt: { kind: "wallet-failed", reason: errorText(error) } });
      return true;
    }
    const now = this.store.getSnapshot(); // the account's reads may have landed while the wallet answered
    let held = now.accountHistory !== "read" || mayHold(now, record); // a history that could not be read says nothing of what it would have shown
    if (!held) {
      // A past staker can be owed a distribution nothing else shows. One signed read per connection settles it, which is what spares the rest.
      if (this.distributed === null) {
        try {
          const answer = await this.store.deps.client.stats.distributions(wallet.address);
          if (this.store.liveWallet !== wallet) return true;
          this.distributed = (answer?.entitled ?? "0") !== "0";
        } catch (error) {
          if (this.store.liveWallet === wallet) this.patch({ attempt: { kind: "node-failed", reason: errorText(error) } });
          return true;
        }
      }
      held = this.distributed;
    }
    if (held && this.emptyKey !== stakeKey(now)) return false;
    this.patch({ nothing: true, attempt: null });
    return true;
  }

  private async readNode(wallet: Wallet, scope: ExitScope, root: string): Promise<void> {
    if (this.answer !== null) return this.takeAnswer(wallet, scope);
    const current = () => this.store.liveWallet === wallet;
    this.triedRoot = root;
    this.patch({ reading: true, nothing: false });
    try {
      const answer = await this.store.deps.client.exitProof(wallet.address);
      if (!current()) return;
      if (answer === null) return this.patch({ attempt: { kind: "no-proof" } });
      this.answer = parseExitProof(answer);
      await this.takeAnswer(wallet, scope);
    } catch (error) {
      if (!current()) return;
      this.patch({ attempt: error instanceof ExitProofError ? { kind: "refused", reason: error.message } : { kind: "node-failed", reason: errorText(error) } });
    } finally {
      if (current()) this.patch({ reading: false });
    }
  }

  /** Checks the node's answer; a wallet that could not leaves it for the next read of the vault, so the node signs nothing more for it. */
  private async takeAnswer(wallet: Wallet, scope: ExitScope): Promise<void> {
    const proof = this.answer;
    if (proof === null) return;
    const current = () => this.store.liveWallet === wallet;
    let outcome: AdoptOutcome;
    try {
      outcome = await this.adopter.adopt(wallet, scope, proof);
    } catch (error) {
      if (current()) this.patch({ attempt: { kind: "wallet-failed", reason: errorText(error) } });
      return;
    }
    if (!current()) return;
    // One ahead of the vault is what it holds next, so it is checked again then, at no signature, and it may be all there is if the node has gone by that time.
    if (outcome.kind !== "other-root" || outcome.proofSeq <= outcome.vaultSeq) this.answer = null;
    const now = this.store.getSnapshot();
    if (outcome.kind === "other-root" && outcome.proofSeq <= outcome.vaultSeq) {
      // Older than a vault that moved while it was read says only that the node has not been asked for the new root; a vault that did not move has a node behind it.
      this.patch({ attempt: this.triedRoot === now.exit.vault?.latestRoot ? { kind: "node-behind", nodeSeq: outcome.proofSeq } : null });
      this.settleAgain = true;
      return;
    }
    this.triedRoot = now.exit.vault?.latestRoot ?? this.triedRoot; // the node has answered for the vault as it is now, or past it: the next read is for the vault's next root
    if (outcome.kind === "other-root") this.patch({ attempt: { kind: "node-ahead", nodeSeq: outcome.proofSeq } });
    else if (outcome.kind === "refused") this.patch({ attempt: { kind: "refused", reason: outcome.reason } });
    else if (outcome.kind === "empty") this.heldNothing(now, scope, proof);
  }

  /** The node's answer at the vault's latest root held nothing: that says the account has nothing only if it covers all the account has done. */
  private heldNothing(now: ConsoleState, scope: ExitScope, proof: ExitProof): void {
    if (holdsNow(now) || proof.seq < newestEventSeq(now)) return this.patch({ attempt: { kind: "not-covered" } });
    if (now.accountHistory !== "read") {
      this.emptyAnswer = proof; // a history still to land may hold what this answer does not: it is judged again once it has, at no signature
      return this.patch({ attempt: null });
    }
    const stored = readStoredExit(this.storage, scope).record;
    // Another tab may have saved a later proof while this answer was checked, which this one says nothing of.
    if ([stored, now.exit.record].some((held) => held !== null && held.proof.seq > proof.seq)) {
      this.settleAgain = true;
      return this.patch({ attempt: null });
    }
    this.emptyKey = stakeKey(now);
    // A saved proof at an older root could never be claimed from again, and an answer that names nothing is no proof of anything, so only that one goes.
    if (stored !== null && stored.proof.root !== proof.root) removeStoredExit(this.storage, scope);
    this.patch({ attempt: null, nothing: true, record: now.exit.record?.proof.root === proof.root ? now.exit.record : null });
  }

  /** Tries an answer the wallet could not check before. */
  async retryAnswer(): Promise<void> {
    const wallet = this.store.liveWallet;
    const scope = this.scope(wallet);
    if (wallet !== null && scope !== null && this.answer !== null) await this.takeAnswer(wallet, scope);
  }
}
