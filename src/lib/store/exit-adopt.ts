/**
 * What the keeper holds a proof to before it counts: its root the vault's latest, read afresh, its seq
 * the vault's own, and every leaf accepted by the vault's `ExitVerifier`. Anything else leaves what is
 * saved alone.
 */

import { exitProofAccount, holdsAnything } from "../engine/exit-proof";
import { readStoredExit, removeStoredExit, writeStoredExit, type ExitRecord, type ExitScope, type ExitStorage } from "../engine/exit-file";
import type { ExitProof, ExitWallet, VaultExitFacts } from "../engine/exit-types";
import type { Wallet } from "../engine/wallet";
import type { AdoptOutcome, ExitState } from "./exit-state";
import { errorText } from "./signing";
import type { ConsoleStore } from "./store";

export class ExitAdopter {
  /** The record the vault's verifier has accepted in this connection, which storage alone does not vouch for. */
  private checked: ExitRecord | null = null;

  constructor(private readonly store: ConsoleStore) {}

  private get storage(): () => ExitStorage | null {
    return this.store.deps.exitStorage ?? (() => null);
  }

  private patch(partial: Partial<ExitState>): void {
    this.store.patch({ exit: { ...this.store.getSnapshot().exit, ...partial } });
  }

  private work<T>(wallet: Wallet, task: () => Promise<T>): Promise<T> {
    return this.store.monkeySession.walletWork.work(wallet, task);
  }

  /** Forgets what the last connection's verifier accepted. */
  reset(): void {
    this.checked = null;
  }

  /** Whether the vault's verifier has accepted `record` in this connection. */
  isChecked(record: ExitRecord): boolean {
    return this.checked === record;
  }

  /** The vault's facts with `proof`'s root, or as they are when its root is not the latest: its seq is only metadata to the verifier, so it must be the vault's own. Read twice when they disagree, as a post can land between two reads. */
  private async factsFor(wallet: Wallet, exit: ExitWallet, proof: ExitProof, held?: VaultExitFacts): Promise<VaultExitFacts> {
    const read = async () => {
      const facts = await this.work(wallet, () => exit.facts());
      if (this.store.liveWallet === wallet) this.patch({ vault: facts, vaultProblem: null, vaultFailures: 0 });
      return facts;
    };
    const vault = held ?? (await read());
    return proof.root === vault.latestRoot && proof.seq !== vault.latestSeq ? read() : vault;
  }

  /** Has the vault's verifier judge a saved proof at its latest root, once per connection, and takes its figures from that answer. */
  async checkSaved(wallet: Wallet, exit: ExitWallet, scope: ExitScope, record: ExitRecord, held: VaultExitFacts): Promise<"good" | "unknown" | "refused"> {
    if (this.checked === record) return "good";
    const refuse = (reason: string): "refused" => {
      removeStoredExit(this.storage, scope);
      this.patch({ record: null, attempt: { kind: "saved-refused", reason } });
      return "refused";
    };
    try {
      const vault = await this.factsFor(wallet, exit, record.proof, held);
      if (this.store.liveWallet !== wallet) return "unknown";
      if (record.proof.root !== vault.latestRoot) return "unknown"; // the vault has moved on: the next settle judges that
      if (record.proof.seq !== vault.latestSeq) return refuse(`it names checkpoint ${record.proof.seq} for the root of checkpoint ${vault.latestSeq}`);
      const verdict = await this.work(wallet, () => exit.check(record.proof, vault.latestRoot));
      if (this.store.liveWallet !== wallet) return "unknown";
      if (!verdict.ok) return refuse(verdict.reason);
      const good: ExitRecord = { ...record, accountClaim: verdict.accountClaim, distributionOwed: verdict.distributionOwed, paidApprovals: verdict.paidApprovals, checkpointAt: vault.lastCheckpointAt };
      this.checked = good;
      this.patch({ record: good, terms: good.proof.terms, attempt: null, nothing: false });
      return "good";
    } catch (error) {
      if (this.store.liveWallet === wallet) this.patch({ attempt: { kind: "wallet-failed", reason: errorText(error) } });
      return "unknown";
    }
  }

  /**
   * Takes `proof` if its root is the vault's latest, read afresh, and the vault's verifier accepts it:
   * saves it unless another tab has saved a later one, and tells the page if the browser would not.
   * Anything else leaves what is saved alone.
   * Error cases:
   * - the wallet could not read the vault or check the proof, or the proof names two accounts
   */
  async adopt(wallet: Wallet, scope: ExitScope, proof: ExitProof): Promise<AdoptOutcome> {
    const exit = wallet.exit;
    if (exit === undefined) throw new Error("This wallet does not read a chain.");
    const named = exitProofAccount(proof);
    if (named !== null && named !== scope.account) return { kind: "refused", reason: `it is for account ${named}` };
    const vault = await this.factsFor(wallet, exit, proof);
    if (proof.root !== vault.latestRoot) return { kind: "other-root", proofSeq: proof.seq, vaultSeq: vault.latestSeq };
    if (proof.seq !== vault.latestSeq) return { kind: "refused", reason: `it names checkpoint ${proof.seq} for the root of checkpoint ${vault.latestSeq}` };
    const { latestRoot, lastCheckpointAt } = vault;
    const verdict = await this.work(wallet, () => exit.check(proof, latestRoot));
    if (!verdict.ok) return { kind: "refused", reason: verdict.reason };
    if (this.store.liveWallet === wallet) this.patch({ terms: proof.terms });
    const { accountClaim, distributionOwed, paidApprovals } = verdict;
    if (!holdsAnything(proof, accountClaim, distributionOwed, paidApprovals)) return { kind: "empty" };
    const later = readStoredExit(this.storage, scope).record;
    if (later !== null && later.proof.seq > proof.seq) {
      // Another tab may have saved the vault's next proof while this one was checked. What storage says of itself decides nothing: the vault does.
      const now = await this.work(wallet, () => exit.facts());
      if (now.latestRoot === later.proof.root) {
        if (this.store.liveWallet === wallet) this.patch({ record: later, vault: now });
        return { kind: "other-root", proofSeq: proof.seq, vaultSeq: now.latestSeq };
      }
    }
    const record: ExitRecord = { ...scope, proof, checkpointAt: lastCheckpointAt, accountClaim, distributionOwed, paidApprovals };
    const storageProblem = writeStoredExit(this.storage, record);
    if (this.store.liveWallet === wallet) {
      this.checked = record;
      this.patch({ record, storageProblem, attempt: null, nothing: false });
      if (vault.exitStartedAt !== 0) await this.store.exit.readClaims();
    }
    return { kind: "saved", record, storageProblem };
  }
}
