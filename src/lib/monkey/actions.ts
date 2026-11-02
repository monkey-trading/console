/**
 * The MONKEY page's transactions: staking, starting and completing an unstake, and claiming a USDC
 * distribution. Each goes through the connected wallet, shows the wallet prompt while it waits,
 * reports its outcome as a toast, and reads the wallet and the node again so the figures follow it.
 */

import type { StakingWallet } from "../engine/staking";
import type { Progress, Wallet } from "../engine/wallet";
import { monkeyExact } from "./figures";
import { formatUsdc } from "../vault";
import { errorText, prompting } from "../store/signing";
import { claimEmissions, emissionsPosition } from "../store/emissions";
import { usdcFixed } from "./figures";
import type { MonkeyPanel } from "./panel";

/** How many rounds a claim re-reads the vault and the node's proof before it keeps the waiting state; as the MONKEY claim does. */
const CLAIM_ATTEMPTS = 3;

/**
 * Runs one wallet transaction. `step` returns the sentence to report when it succeeded, or null
 * when it has already reported why nothing was sent. Resolves true once a transaction landed.
 */
async function run(panel: MonkeyPanel, action: string, step: (wallet: Wallet, staking: StakingWallet, progress: Progress) => Promise<string | null>): Promise<boolean> {
  const { store } = panel;
  const wallet = store.liveWallet;
  if (wallet === null) {
    store.toast("error", "Connect a wallet first.");
    return false;
  }
  const staking = wallet.staking;
  if (wallet.readOnly === true || staking === undefined) {
    store.toast("error", "This wallet cannot send transactions.");
    return false;
  }
  if (store.getSnapshot().busy) return false;
  let landed = false;
  // The task waits its turn behind the page's wallet reads; busy and the wallet prompt belong to it
  // only once it starts, so a wallet that is slow to answer a read does not lock the console.
  const ran = await panel.exclusive(async () => {
    if (store.liveWallet !== wallet) {
      store.toast("info", "The wallet changed while this was waiting, so nothing was sent.");
      return;
    }
    // Another page's request may have started while this one waited: sending beside it would overwrite its prompt.
    if (store.getSnapshot().busy) {
      store.toast("info", "Another request is in progress, so nothing was sent.");
      return;
    }
    store.patch({ busy: true });
    try {
      const done = await prompting(store, `Confirm in your wallet: ${action}.`, () => step(wallet, staking, (waitingFor) => store.patch({ prompt: waitingFor })));
      if (done !== null) {
        landed = true;
        store.toast("ok", done);
      }
    } catch (error) {
      store.toast("error", errorText(error));
    } finally {
      store.patch({ busy: false });
    }
  });
  if (ran === null) {
    store.toast("info", "Your earlier request is still with your wallet.");
    return false;
  }
  // The chain moved, or the node's proof did: read both again on the page that is open now, which
  // may not be the one the transaction started on.
  const open = store.monkeySession.panel;
  if (open !== null) {
    await open.refreshWallet(true);
    void open.refreshNode();
  }
  return landed;
}

/** Stakes `amount` MONKEY base units, approving the staking contract first if needed. */
export function stakeMonkey(panel: MonkeyPanel, amount: bigint): Promise<boolean> {
  return run(panel, `stake ${monkeyExact(amount)}`, async (_wallet, staking, progress) => {
    await staking.stake(amount, progress);
    return `Staked ${monkeyExact(amount)}.`;
  });
}

/** Starts unstaking `amount`; it can be completed, and then returns to the wallet, once the cooldown has passed. */
export function startUnstake(panel: MonkeyPanel, amount: bigint): Promise<boolean> {
  return run(panel, `unstake ${monkeyExact(amount)}`, async (_wallet, staking, progress) => {
    await staking.startUnstake(amount, progress);
    return `Unstake of ${monkeyExact(amount)} started. You can complete it once the cooldown has passed.`;
  });
}

export function completeUnstake(panel: MonkeyPanel): Promise<boolean> {
  return run(panel, "complete the unstake", async (_wallet, staking, progress) => {
    await staking.completeUnstake(progress);
    return "Unstake complete. The MONKEY is back in your wallet.";
  });
}

/**
 * Claims the account's USDC distribution. The vault checks a proof against its latest posted
 * root, so the claim needs the proof for that checkpoint, not the page's last-read pair: both are
 * read again, bounded, and the claim is sent with the pair whose seqs meet.
 */
export function claimDistribution(panel: MonkeyPanel): Promise<boolean> {
  const { store } = panel;
  return run(panel, "claim your USDC distribution", async (wallet, staking, progress) => {
    const address = wallet.address;
    for (let attempt = 1; ; attempt += 1) {
      const position = await staking.position();
      const proof = await store.deps.client.stats.distributions(address);
      // Another wallet may have been connected while the reads ran: this one's claim is not sent.
      if (store.liveWallet !== wallet) {
        store.toast("info", "The wallet changed while the claim was prepared, so nothing was sent.");
        return null;
      }
      if (proof === null) {
        store.toast("info", "The node holds no distribution proof for this account right now.");
        return null;
      }
      if (proof.seq === position.latestSeq) {
        const due = BigInt(proof.entitled) - position.distributionsClaimed;
        if (due <= 0n) {
          store.toast("info", "All distributed USDC is claimed.");
          return null;
        }
        await staking.claimDistribution(proof, progress);
        return `The vault paid ${formatUsdc(usdcFixed(due))} to your wallet.`;
      }
      if (attempt >= CLAIM_ATTEMPTS) {
        store.toast("info", "The vault's latest checkpoint and the node's latest proof have not met yet; the claim unlocks once they do.");
        return null;
      }
    }
  });
}

/** What a USDC distribution claim stands at, from the proof and the vault's record; the MONKEY claim's states apply unchanged. */
export function distributionPosition(proof: Parameters<typeof emissionsPosition>[0], position: { distributionsClaimed: bigint; latestSeq: number } | null) {
  return emissionsPosition(proof, position === null ? null : { claimed: position.distributionsClaimed, latestSeq: position.latestSeq });
}

/**
 * Claims the account's MONKEY emissions through the same queue as the page's other wallet work:
 * for the wallet clicked on, sending nothing if it is no longer the connected one or another
 * request has started, and once it has finished the page that is open then reads again.
 */
export async function claimMonkeyEmissions(panel: MonkeyPanel): Promise<void> {
  const { store } = panel;
  const wallet = store.liveWallet;
  const ran = await panel.exclusive(async () => {
    if (store.liveWallet !== wallet) store.toast("info", "The wallet changed while this was waiting, so nothing was sent.");
    else if (store.getSnapshot().busy) store.toast("info", "Another request is in progress, so nothing was sent.");
    else {
      await claimEmissions(store);
    }
  });
  if (ran === null) store.toast("info", "Your earlier request is still with your wallet.");
  await store.monkeySession.panel?.refreshWallet(true);
}
