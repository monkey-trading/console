/**
 * The connected account's MONKEY emissions: where its entitlement stands against the vault's
 * record, the background read of that record, and the claim that closes the gap.
 */

import { accruedOf, carryAccrued } from "../engine/claim-standing";
import type { EntitlementProof } from "../engine/emissions";
import type { Wallet } from "../engine/wallet";
import { formatMonkey } from "../format";
import { abandoned, errorText, prompting, usableWallet } from "./signing";
import type { ConsoleStore } from "./store";

/** Where the account's MONKEY stands: what it has earned, what the node's proof against the vault's checkpoint owes, and what the vault has minted. */
export interface EmissionsPosition {
  /** The cumulative entitlement at the node's newest checkpoint (`newest_entitled`, else the proof's own), in MONKEY base units; zero before the node holds one. */
  accrued: bigint;
  /** The part of `accrued` the proof does not cover: it can be claimed once the vault accepts the newest checkpoint. Zero from a node that does not say. */
  awaiting: bigint;
  /** What the vault has minted so far, or null before its record has been read. */
  claimed: bigint | null;
  /**
   * Where the vault's latest posted checkpoint stands against the proof: `unknown` before its
   * record is read, `waiting` while it has not reached the proof's seq, `posted` at it — the only
   * state a claim works in, since the vault verifies a proof against its latest root — and
   * `superseded` once a newer checkpoint has passed it.
   */
  checkpoint: "unknown" | "waiting" | "posted" | "superseded";
  /** What a claim would mint now: the proof's entitlement less what the vault has minted; zero unless the checkpoint is posted. */
  claimable: bigint;
}

/** The account's MONKEY position from what the page holds; nothing is claimable without a proof. */
export function emissionsPosition(entitlement: EntitlementProof | null, vault: { claimed: bigint; latestSeq: number } | null): EmissionsPosition {
  if (entitlement === null) return { accrued: 0n, awaiting: 0n, claimed: vault?.claimed ?? null, checkpoint: "unknown", claimable: 0n };
  const proven = BigInt(entitlement.entitled);
  const accrued = accruedOf(entitlement);
  const claimed = vault?.claimed ?? null;
  const checkpoint = vault === null ? "unknown" : vault.latestSeq < entitlement.seq ? "waiting" : vault.latestSeq === entitlement.seq ? "posted" : "superseded";
  const claimable = checkpoint === "posted" && claimed !== null ? (proven > claimed ? proven - claimed : 0n) : 0n;
  return { accrued, awaiting: accrued - proven, claimed, checkpoint, claimable };
}

/**
 * How many rounds a claim re-reads the vault record and the node's proof before it keeps the
 * waiting state. Each round is a pair of network reads, and the pair meets within a few rounds
 * once the vault posts the checkpoint the node's latest proof stands at.
 */
const CLAIM_PROOF_ATTEMPTS = 3;

/**
 * Reads the vault's record of the connected account's MONKEY through the wallet's chain provider:
 * what it has minted and its latest posted checkpoint seq. One read per wallet at a time; a failed
 * read leaves the record unread, which the card says, and the MONKEY page's next wallet read tries it again.
 */
export async function checkEmissionsClaimed(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  if (!wallet?.emissionsClaimed || store.emissionsCheck === wallet) return;
  store.emissionsCheck = wallet;
  const current = () => store.liveWallet === wallet;
  try {
    const record = await wallet.emissionsClaimed();
    // The wallet may have changed while the read ran; another account's record is not shown.
    if (current()) store.patch({ emissionsVault: record });
  } catch {
    // The card says the vault's record has not been read, and the next refresh asks again.
  } finally {
    if (store.emissionsCheck === wallet) store.emissionsCheck = null;
  }
}

/**
 * Claims the connected account's MONKEY emissions on the vault. The wallet is asked to send what the
 * node's proof says, so the claim waits on a verdict that may sign: the vault checks the proof, and a
 * node it has not judged could cost the user a reverted transaction's gas.
 */
export async function claimEmissions(store: ConsoleStore): Promise<void> {
  store.clearNotice("emissions");
  const wallet = store.liveWallet;
  if (!wallet) return store.notify("emissions", "Connect a wallet first.");
  // Bound to the wallet: calling the method without a receiver unbinds `this` in the provider wallet.
  const claim = wallet.claimEmissions?.bind(wallet);
  const readRecord = wallet.emissionsClaimed?.bind(wallet);
  if (claim === undefined || readRecord === undefined) return store.notify("emissions", "This wallet cannot claim MONKEY.");
  store.patch({ busy: true });
  // Set once the mint has landed: the token offer is made after the claim has finished, so a caller that queues the claim holds the wallet until the offer has been answered too.
  let offered: Wallet | null = null;
  try {
    // The vault claims against its current latest root, so the claim needs the proof for the
    // vault's latest posted checkpoint, not the page's last-read pair: under a fast sequencer the
    // vault and the node's newest proof pass each other between refreshes. Re-read both, bounded,
    // and claim with the pair whose seqs meet.
    for (let attempt = 1; ; attempt += 1) {
      const [record, proof] = await Promise.all([readRecord(), store.deps.client.emissions(wallet.address)]);
      if (store.liveWallet !== wallet) return; // the wallet changed while the reads ran; its claim is not this one's
      store.patch({ entitlement: proof === null ? null : carryAccrued(store.getSnapshot().entitlement, proof), emissionsVault: record });
      if (proof === null) return store.notify("emissions", "The node holds no entitlement proof for this account right now.", "info");
      if (proof.seq === record.latestSeq) {
        const due = BigInt(proof.entitled) - record.claimed;
        if (due <= 0n) return; // the card already says all of it is claimed
        // Checked last: the verdict may have ended while the reads above waited on the wallet.
        if (usableWallet(store, "claim MONKEY", "emissions") === null) return;
        const amount = formatMonkey(due);
        await prompting(store, wallet, "emissions", `Confirm in your wallet: claim ${amount} from the vault.`, (progress) => claim(proof, progress));
        offered = wallet;
        break;
      }
      if (attempt >= CLAIM_PROOF_ATTEMPTS) {
        // Genuine lag: the card's waiting line stands; say why the claim did not fire.
        return store.notify("emissions", "The vault's latest checkpoint and the node's latest proof have not met yet; the claim unlocks once they do.", "info");
      }
    }
  } catch (error) {
    if (!abandoned(store, wallet, error)) store.notify("emissions", errorText(error));
  } finally {
    // The vault's record changed with the claim, or the reads above refreshed it; the page reads it
    // again once the claim has finished, which settles the claimed-versus-accrued line.
    if (store.liveWallet === wallet) store.patch({ busy: false, emissionsVault: null });
  }
  if (offered !== null) await offerMonkeyImport(offered);
}

/** Offers to add the vault's MONKEY to the wallet that just claimed. The wallet shows its own balance and a decline needs no word. */
function offerMonkeyImport(wallet: Wallet): Promise<void> {
  if (wallet.readOnly || wallet.suggestMonkey === undefined) return Promise.resolve();
  return wallet.suggestMonkey().then(() => undefined, () => undefined);
}
