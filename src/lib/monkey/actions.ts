/**
 * The MONKEY and Staking pages' transactions: staking, starting and completing an unstake, delegating,
 * moving and taking back amounts of stake, and claiming a USDC distribution. Each goes through the connected wallet, shows the wallet prompt while it waits,
 * says on its panel why nothing was sent or what failed, and reads the wallet and the node again so
 * the figures follow it.
 */

import type { StakingWallet } from "../engine/staking";
import type { Progress, Wallet } from "../engine/wallet";
import { monkeyExact } from "./figures";
import { abandoned, errorText, notBusy, prompting, usableWallet } from "../store/signing";
import { checkpointOf } from "../engine/claim-standing";
import { claimEmissions, emissionsPosition, WAITING_ON_VAULT } from "../store/emissions";
import type { NoticeSurface } from "../store/state";
import type { DelegationReads } from "../staking/delegation-reads";
import type { OperatorReads } from "./operators";
import type { MonkeyPanel } from "./panel";

/** How many rounds a claim re-reads the vault and the node's proof before it keeps the waiting state, for a node that does not say whether its proof is claimable; as the MONKEY claim does. */
const CLAIM_ATTEMPTS = 3;

/**
 * Runs one wallet transaction for the panel on `surface`. `step` returns true when the transaction was
 * sent, or false when it has already said why nothing was. `onLanded` runs the moment a transaction
 * has landed, before the wallet and the node are read again. Resolves true once one landed.
 */
async function run(panel: MonkeyPanel, surface: NoticeSurface, action: string, step: (wallet: Wallet, staking: StakingWallet, progress: Progress) => Promise<boolean>, movesStake = false, onLanded?: () => void): Promise<boolean> {
  const { store } = panel;
  store.clearNotice(surface);
  const wallet = store.liveWallet;
  if (wallet === null) {
    store.notify(surface, "Connect a wallet first.");
    return false;
  }
  const staking = wallet.staking;
  if (wallet.readOnly === true || staking === undefined) {
    store.notify(surface, "This wallet cannot send transactions.");
    return false;
  }
  if (store.getSnapshot().busy) return false;
  let landed = false;
  // The task waits its turn behind the page's wallet reads; busy and the wallet prompt belong to it
  // only once it starts, so a wallet that is slow to answer a read does not lock the console.
  const ran = await panel.exclusive(async () => {
    if (store.liveWallet !== wallet) {
      store.notify(surface, "The wallet changed while this was waiting, so nothing was sent.", "info");
      return;
    }
    // Another page's request may have started while this one waited: sending beside it would overwrite its prompt.
    if (store.getSnapshot().busy) {
      store.notify(surface, "Another request is in progress, so nothing was sent.", "info");
      return;
    }
    store.patch({ busy: true });
    try {
      if (await prompting(store, wallet, surface, `Confirm in your wallet: ${action}.`, (progress) => step(wallet, staking, progress))) {
        landed = true;
        onLanded?.();
      }
    } catch (error) {
      if (!abandoned(store, wallet, error)) store.notify(surface, errorText(error));
    } finally {
      notBusy(store, wallet);
    }
  });
  if (ran === null) {
    store.notify(surface, "Your earlier request is still with your wallet.", "info");
    return false;
  }
  // The chain moved, or the node's proof did: read both again on the page that is open now, which
  // may not be the one the transaction started on. Every staking transaction moves the delegations' figures too.
  const delegations = landed ? store.monkeySession.delegations?.refresh() : undefined;
  const open = store.monkeySession.panel;
  if (open !== null) {
    // The node's total follows the chain a little later than the wallet's read does.
    if (landed && movesStake) open.holdShare();
    // The forms stay shut until the re-reads have finished: the balance and the delegations they check against are the old ones until then.
    const reread = Promise.all([open.refreshWallet(true), delegations]);
    await (landed ? open.settle(reread) : reread);
    void open.refreshNode();
  } else {
    await delegations;
  }
  return landed;
}

/** Stakes `amount` MONKEY base units, approving the staking contract first if needed. */
export function stakeMonkey(panel: MonkeyPanel, amount: bigint, onLanded?: () => void): Promise<boolean> {
  return run(panel, "stake", `stake ${monkeyExact(amount)}`, async (_wallet, staking, progress) => {
    await staking.stake(amount, progress);
    return true;
  }, true, onLanded);
}

/** Starts unstaking `amount`; it can be completed, and then returns to the wallet, once the cooldown has passed. */
export function startUnstake(panel: MonkeyPanel, amount: bigint, onLanded?: () => void): Promise<boolean> {
  return run(panel, "stake", `unstake ${monkeyExact(amount)}`, async (_wallet, staking, progress) => {
    await staking.startUnstake(amount, progress);
    return true;
  }, false, onLanded);
}

export function completeUnstake(panel: MonkeyPanel): Promise<boolean> {
  return run(panel, "stake", "complete the unstake", async (_wallet, staking, progress) => {
    await staking.completeUnstake(progress);
    return true;
  }, true);
}

/** A change to the account's delegations (monkey-trading/engine#586); each `label` is how the page names that candidate. */
export type DelegationChange =
  | { kind: "delegate"; to: string; toLabel: string; amount: bigint }
  | { kind: "undelegate"; from: string; fromLabel: string; amount: bigint }
  | { kind: "redelegate"; from: string; fromLabel: string; to: string; toLabel: string; amount: bigint };

/** What the wallet prompt says a change does. */
export function changeText(change: DelegationChange): string {
  const amount = monkeyExact(change.amount);
  switch (change.kind) {
    case "delegate": return `delegate ${amount} to ${change.toLabel}`;
    case "undelegate": return `take back ${amount} from ${change.fromLabel}`;
    case "redelegate": return `move ${amount} from ${change.fromLabel} to ${change.toLabel}`;
    default: {
      const never: never = change;
      throw new Error(`Unknown delegation change ${String(never)}.`);
    }
  }
}

/**
 * Sends `change` through the wallet, then reads the account's delegations and the operator list
 * again. It needs nothing from the node, so it goes while the node is down or unverified, which
 * keeps a staker able to vote away from it.
 */
export async function changeDelegation(panel: MonkeyPanel, operators: OperatorReads, delegations: DelegationReads, change: DelegationChange, onLanded?: () => void): Promise<boolean> {
  const landed = await run(panel, "operator", changeText(change), async (_wallet, staking, progress) => {
    if (change.kind === "delegate") await staking.delegate(change.to, change.amount, progress);
    else if (change.kind === "undelegate") await staking.undelegate(change.from, change.amount, progress);
    else await staking.redelegate(change.from, change.to, change.amount, progress);
    return true;
  }, false, onLanded);
  await Promise.all([delegations.refresh(), operators.refresh()]);
  return landed;
}

/**
 * Claims the account's USDC distribution. The vault checks a proof against the root it keeps for
 * the proof's seq, and the node's answer says whether that checkpoint is one the vault accepted
 * (`claimable`), so the claim is sent on the node's current word and what the vault has paid, both
 * read again, never on the wallet's read of the vault's latest seq running behind. A node without
 * the field is compared with that seq, bounded rounds. Later checkpoints do not undo a claim. It is
 * built from the node's proof, so unlike a stake or a delegation it waits on a verdict that may sign.
 */
export function claimDistribution(panel: MonkeyPanel): Promise<boolean> {
  const { store } = panel;
  return run(panel, "distribution", "claim your USDC distribution", async (wallet, staking, progress) => {
    const address = wallet.address;
    for (let attempt = 1; ; attempt += 1) {
      const position = await staking.position();
      const proof = await store.deps.client.stats.distributions(address);
      // Another wallet may have been connected while the reads ran: this one's claim is not sent.
      if (store.liveWallet !== wallet) {
        store.notify("distribution", "The wallet changed while the claim was prepared, so nothing was sent.", "info");
        return false;
      }
      if (proof === null) {
        store.notify("distribution", "The node holds no distribution proof for this account right now.", "info");
        return false;
      }
      if (checkpointOf(proof, position.latestSeq) === "posted") {
        const due = BigInt(proof.entitled) - position.distributionsClaimed;
        if (due <= 0n) return false; // the panel already says all of it is claimed
        // Checked last: the verdict may have ended while the reads above waited on the wallet.
        if (usableWallet(store, "claim the USDC distribution", "distribution") === null) return false;
        await staking.claimDistribution(proof, progress);
        return true;
      }
      if (proof.claimable !== undefined || attempt >= CLAIM_ATTEMPTS) {
        store.notify("distribution", WAITING_ON_VAULT, "info");
        return false;
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
  store.clearNotice("emissions");
  const ran = await panel.exclusive(async () => {
    if (store.liveWallet !== wallet) store.notify("emissions", "The wallet changed while this was waiting, so nothing was sent.", "info");
    else if (store.getSnapshot().busy) store.notify("emissions", "Another request is in progress, so nothing was sent.", "info");
    else {
      await claimEmissions(store);
    }
  });
  if (ran === null) store.notify("emissions", "Your earlier request is still with your wallet.", "info");
  await store.monkeySession.panel?.refreshWallet(true);
}
