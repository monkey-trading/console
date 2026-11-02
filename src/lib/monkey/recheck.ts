/** Reading a disagreeing pair again by itself: the vault's checkpoint and the node's proof, for both claim panels (monkey-trading/console#202). */

import { carryAccrued } from "../engine/claim-standing";
import { emissionsPosition } from "../store/emissions";
import type { ConsoleStore } from "../store/store";
import { distributionPosition } from "./actions";
import type { PanelState } from "./panel";
import { CHECK_GRACE_MS, disagrees, RECHECK_MS } from "./verdict";

/** Whether either claim panel holds a vault record and a proof that do not meet. */
export function pairDisagrees(store: ConsoleStore, state: PanelState): boolean {
  const { entitlement, emissionsVault } = store.getSnapshot();
  const proof = state.wallet.proof.value;
  return disagrees(emissionsPosition(entitlement, emissionsVault).checkpoint) || (proof !== null && disagrees(distributionPosition(proof, state.wallet.position.value).checkpoint));
}

/** Reads the node's emissions proof for the connected account again, into the store, as the claim does. */
async function readEntitlement(store: ConsoleStore): Promise<void> {
  const address = store.liveWallet?.address;
  if (address === undefined) return;
  try {
    const proof = await store.deps.client.emissions(address);
    if (store.liveWallet?.address === address && proof !== null) store.patch({ entitlement: carryAccrued(store.getSnapshot().entitlement, proof) });
  } catch {
    // The panel's own read says why it failed; this one only hurries the pair along, and the next read tries again.
  }
}

/** Re-reads a pair that disagrees every `RECHECK_MS`, for at most the grace period; the page's slower timer carries on after it. */
export class PairCheck {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rounds = 0;

  /** Called after each wallet read: schedules another round while the pair disagrees, and resets when it meets. */
  after(store: ConsoleStore, state: PanelState, open: () => boolean, reread: () => Promise<void>): void {
    if (!pairDisagrees(store, state)) {
      this.rounds = 0;
      return;
    }
    if (this.timer !== null || this.rounds >= CHECK_GRACE_MS / RECHECK_MS) return;
    this.rounds += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (open()) void readEntitlement(store).then(reread);
    }, RECHECK_MS);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.rounds = 0;
  }
}
