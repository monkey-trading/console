/**
 * The connected account's MONKEY emissions: where its entitlement stands against the vault's
 * record, the background read of that record, and the claim that closes the gap.
 */

import type { EntitlementProof } from "../engine/emissions";
import type { Wallet } from "../engine/wallet";
import { formatMonkey } from "../format";
import { errorText, prompting } from "./signing";
import type { ConsoleStore } from "./store";

/** Where the account's MONKEY stands: what the node's last posted root proves owed against what the vault has minted. */
export interface EmissionsPosition {
  /** The cumulative entitlement the proof names, in MONKEY base units; zero before the node holds one. */
  accrued: bigint;
  /** What the vault has minted so far, or null before its record has been read. */
  claimed: bigint | null;
  /**
   * Where the vault's latest posted checkpoint stands against the proof: `unknown` before its
   * record is read, `waiting` while it has not reached the proof's seq, `posted` at it — the only
   * state a claim works in, since the vault verifies a proof against its latest root — and
   * `superseded` once a newer checkpoint has passed it.
   */
  checkpoint: "unknown" | "waiting" | "posted" | "superseded";
  /** What a claim would mint now; zero unless the checkpoint is posted and something is due. */
  claimable: bigint;
}

/** The account's MONKEY position from what the page holds; nothing is claimable without a proof. */
export function emissionsPosition(entitlement: EntitlementProof | null, vault: { claimed: bigint; latestSeq: number } | null): EmissionsPosition {
  if (entitlement === null) return { accrued: 0n, claimed: vault?.claimed ?? null, checkpoint: "unknown", claimable: 0n };
  const accrued = BigInt(entitlement.entitled);
  const claimed = vault?.claimed ?? null;
  const checkpoint = vault === null ? "unknown" : vault.latestSeq < entitlement.seq ? "waiting" : vault.latestSeq === entitlement.seq ? "posted" : "superseded";
  const claimable = checkpoint === "posted" && claimed !== null ? (accrued > claimed ? accrued - claimed : 0n) : 0n;
  return { accrued, claimed, checkpoint, claimable };
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
 * read is reported once, and the MONKEY page's next wallet read tries it again.
 */
export async function checkEmissionsClaimed(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  if (!wallet?.emissionsClaimed || store.emissionsCheck === wallet) return;
  store.emissionsCheck = wallet;
  const current = () => store.liveWallet === wallet;
  try {
    const record = await wallet.emissionsClaimed();
    // The wallet may have changed while the read ran; another account's record is not shown.
    if (current()) {
      store.lastEmissionsReadError = null;
      store.patch({ emissionsVault: record });
    }
  } catch (error) {
    // A failure of a wallet that is no longer connected belongs to that wallet's session, not this one.
    if (current()) {
      // The read is asked again on the next refresh, so a failure that keeps repeating is shown once.
      const message = errorText(error);
      if (store.lastEmissionsReadError !== message) {
        store.lastEmissionsReadError = message;
        store.toast("error", `The vault's MONKEY record could not be read: ${message}`);
      }
    }
  } finally {
    if (store.emissionsCheck === wallet) store.emissionsCheck = null;
  }
}

/**
 * Claims the connected account's MONKEY emissions on the vault. A claim signs nothing for the
 * node, so it needs only the wallet, like a payout claim; each proof was verified when it was
 * read.
 */
export async function claimEmissions(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  if (!wallet) return store.toast("error", "Connect a wallet first.");
  // Bound to the wallet: calling the method without a receiver unbinds `this` in the provider wallet.
  const claim = wallet.claimEmissions?.bind(wallet);
  const readRecord = wallet.emissionsClaimed?.bind(wallet);
  if (claim === undefined || readRecord === undefined) return store.toast("error", "This wallet cannot claim MONKEY.");
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
      store.patch({ entitlement: proof, emissionsVault: record });
      if (proof === null) return store.toast("info", "The node holds no entitlement proof for this account right now.");
      if (proof.seq === record.latestSeq) {
        const due = BigInt(proof.entitled) - record.claimed;
        if (due <= 0n) return store.toast("info", "All accrued MONKEY is claimed.");
        const amount = formatMonkey(due);
        await prompting(store, `Confirm in your wallet: claim ${amount} from the vault.`, () => claim(proof, (waitingFor) => store.patch({ prompt: waitingFor })));
        // The mint belongs to the account that claimed it, which may no longer be the one connected.
        const after = store.getSnapshot();
        store.toast("ok", `The vault minted ${amount} to ${after.wallet?.address === wallet.address ? "your wallet" : wallet.address}.`);
        offered = wallet;
        break;
      }
      if (attempt >= CLAIM_PROOF_ATTEMPTS) {
        // Genuine lag: the card's waiting line stands; say why the claim did not fire.
        return store.toast("info", "The vault's latest checkpoint and the node's latest proof have not met yet; the claim unlocks once they do.");
      }
    }
  } catch (error) {
    store.toast("error", errorText(error));
  } finally {
    // The vault's record changed with the claim, or the reads above refreshed it; the page reads it
    // again once the claim has finished, which settles the claimed-versus-accrued line.
    store.patch({ busy: false, emissionsVault: null });
  }
  if (offered !== null) await offerMonkeyImport(store, offered);
}

/** Offers to add the vault's MONKEY to the wallet that just claimed; one small toast when it is added, silence on a decline. */
function offerMonkeyImport(store: ConsoleStore, wallet: Wallet): Promise<void> {
  if (wallet.readOnly || wallet.suggestMonkey === undefined) return Promise.resolve();
  return wallet.suggestMonkey().then(
    (added) => { if (added) store.toast("info", "MONKEY was added to your wallet, so its balance shows there."); },
    () => undefined,
  );
}
