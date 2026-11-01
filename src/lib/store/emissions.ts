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

/** How long a stale vault record waits before it is read again, in milliseconds of the node's clock. */
export const EMISSIONS_READ_RETRY_MS = 60_000;

/**
 * Whether the vault's record should be read now: always when it has not been read, and again when
 * the proof's checkpoint has passed it — the vault posts checkpoints on its own, so a record
 * behind the proof has simply not seen them yet. The retry waits out `EMISSIONS_READ_RETRY_MS` of
 * node time so a checkpoint still posting does not spin the wallet's chain provider.
 */
export function emissionsRecordStale(entitlement: EntitlementProof, vault: { latestSeq: number } | null, nowMs: number, lastReadAtMs: number): boolean {
  if (vault === null || vault.latestSeq < entitlement.seq) return lastReadAtMs < 0 || nowMs - lastReadAtMs >= EMISSIONS_READ_RETRY_MS;
  return false;
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
    if (store.liveWallet === wallet) {
      store.lastEmissionsReadError = null;
      store.patch({ emissionsVault: record });
    }
  } catch (error) {
    // The read is asked again on the next refresh, so a failure that keeps repeating is shown once.
    const message = errorText(error);
    if (store.lastEmissionsReadError !== message) {
      store.lastEmissionsReadError = message;
      store.toast("error", `The vault's MONKEY record could not be read: ${message}`);
    }
  } finally {
    // The throttle window runs from the read's end, whatever it answered.
    store.lastEmissionsReadAt = store.getSnapshot().now;
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
    const after = store.getSnapshot();
    store.toast("ok", `The vault minted ${amount} to ${after.wallet?.address === wallet.address ? "your wallet" : wallet.address}.`);
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
