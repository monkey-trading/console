/**
 * The connected account's MONKEY emissions: where its entitlement stands against the vault's
 * record, the background read of that record, and the claim that closes the gap.
 */

import type { EntitlementProof } from "../engine/emissions";
import type { Wallet } from "../engine/wallet";
import { formatMonkey } from "../format";
import { errorText, prompting } from "./actions";
import type { ConsoleStore } from "./store";

/** Where the account's MONKEY stands: what the node's last posted root proves owed against what the vault has minted. */
export interface EmissionsPosition {
  /** The cumulative entitlement the proof names, in MONKEY base units; zero before the node holds one. */
  accrued: bigint;
  /** What the vault has minted so far, or null before its record has been read. */
  claimed: bigint | null;
  /** Whether the vault has posted a checkpoint at or past the proof's seq, which the claim needs. */
  posted: boolean;
  /** What a claim would mint now; zero while the record is unread, the checkpoint unposted, or nothing is due. */
  claimable: bigint;
}

/** The account's MONKEY position from what the page holds; nothing is claimable without a proof. */
export function emissionsPosition(entitlement: EntitlementProof | null, vault: { claimed: bigint; latestSeq: number } | null): EmissionsPosition {
  if (entitlement === null) return { accrued: 0n, claimed: vault?.claimed ?? null, posted: false, claimable: 0n };
  const accrued = BigInt(entitlement.entitled);
  const claimed = vault?.claimed ?? null;
  const posted = vault !== null && vault.latestSeq >= entitlement.seq;
  const claimable = claimed !== null && posted ? (accrued > claimed ? accrued - claimed : 0n) : 0n;
  return { accrued, claimed, posted, claimable };
}

/**
 * Reads the vault's record of the connected account's MONKEY through the wallet's chain provider:
 * what it has minted and its latest posted checkpoint seq. One read per wallet at a time; a failed
 * read is reported once, and the effect that asked retries it when the proof changes.
 */
export async function checkEmissionsClaimed(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  if (!wallet?.emissionsClaimed || store.emissionsCheck === wallet) return;
  store.emissionsCheck = wallet;
  try {
    const record = await wallet.emissionsClaimed();
    // The wallet may have changed while the read ran; another account's record is not shown.
    if (store.liveWallet === wallet) store.patch({ emissionsVault: record });
  } catch (error) {
    store.toast("error", `The vault's MONKEY record could not be read: ${errorText(error)}`);
  } finally {
    if (store.emissionsCheck === wallet) store.emissionsCheck = null;
  }
}

/**
 * Claims the connected account's MONKEY emissions on the vault. A claim signs nothing for the
 * node, so it needs only the wallet, like a payout claim; the proof was verified when it was read.
 */
export async function claimEmissions(store: ConsoleStore): Promise<void> {
  const state = store.getSnapshot();
  const proof = state.entitlement;
  const wallet = store.liveWallet;
  if (!wallet) return store.toast("error", "Connect a wallet first.");
  // Bound to the wallet: calling the method without a receiver unbinds `this` in the provider wallet.
  const claim = wallet.claimEmissions?.bind(wallet);
  if (proof === null || claim === undefined) return store.toast("error", "This wallet cannot claim MONKEY.");
  const claimable = emissionsPosition(proof, state.emissionsVault).claimable;
  if (claimable === 0n) return;
  const amount = formatMonkey(claimable);
  store.patch({ busy: true });
  try {
    await prompting(store, `Confirm in your wallet: claim ${amount} from the vault.`, () => claim(proof, (waitingFor) => store.patch({ prompt: waitingFor })));
    // The mint belongs to the account that claimed it, which may no longer be the one connected.
    store.toast("ok", `The vault minted ${amount} to ${wallet.address === state.wallet?.address ? "your wallet" : wallet.address}.`);
    offerMonkeyImport(store, wallet);
  } catch (error) {
    store.toast("error", errorText(error));
  } finally {
    // The vault's record changed with the claim; a fresh read settles the claimed-versus-accrued line.
    store.patch({ busy: false, emissionsVault: null });
  }
}

/** Offers to add the vault's MONKEY to the wallet that just claimed; one small toast when it is added, silence on a decline. */
function offerMonkeyImport(store: ConsoleStore, wallet: Wallet): void {
  if (wallet.readOnly || wallet.suggestMonkey === undefined) return;
  void wallet.suggestMonkey().then(
    (added) => { if (added) store.toast("info", "MONKEY was added to your wallet, so its balance shows there."); },
    () => undefined,
  );
}
