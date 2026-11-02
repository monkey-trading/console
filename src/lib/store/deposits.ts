/**
 * The deposits the node has yet to credit (monkey-trading/console#234): the amount from the moment the
 * wallet sends one, and, after a reload, the vault's own `Deposited` events for the account that the node's
 * custody receipts do not name yet. The vault is the source of truth and nothing is stored in the browser. The
 * chain read is a hint: when it fails the line stays as it was and nothing is said, since the funds are safe either way.
 */

import { fixedFromWire, type Fixed } from "../fixed";
import type { VaultDeposit } from "../engine/provider-deposits";
import type { EngineEvent } from "../engine/types";
import type { PendingDeposit } from "./state";
import type { ConsoleStore } from "./store";

/** How many of the account's latest custody receipts are read to tell which deposits the node has. */
const RECEIPTS = 100;

/** How long after a send that the vault's events did not show yet it is read once more, in milliseconds. */
const RETRY_MS = 5_000;

/** Whether `wire` is `amount`; a malformed amount is nobody's. */
function sameAmount(amount: Fixed, wire: string): boolean {
  try {
    return amount === fixedFromWire(wire);
  } catch {
    return false;
  }
}

/** The wallet sent a deposit of `amount`: it shows at once, and the vault is read for its id. A wallet that reads no chain, such as the mock's, whose node credits at once, shows none. */
export function noteSentDeposit(store: ConsoleStore, amount: Fixed): void {
  if (store.liveWallet?.vaultDeposits === undefined) return;
  const { pendingDeposits } = store.getSnapshot();
  store.patch({ pendingDeposits: [...pendingDeposits, { id: null, amount }] });
  void readPendingDeposits(store).then(() => {
    // A provider can lag the receipt of its own transaction: the vault's events are asked again once.
    if (store.getSnapshot().pendingDeposits.some((d) => d.id === null)) setTimeout(() => void readPendingDeposits(store), RETRY_MS);
  });
}

/**
 * Replaces the pending deposits with the vault's events for the account that neither the node's receipts nor a
 * stream event have credited. A wallet that reads no chain (the mock's), a read that fails, a connection that ended
 * meanwhile, or a read that a later one overtook leaves them as they were.
 */
export async function readPendingDeposits(store: ConsoleStore): Promise<void> {
  const wallet = store.liveWallet;
  const address = store.getSnapshot().wallet?.address;
  if (wallet === null || wallet.vaultDeposits === undefined || address === undefined) return;
  const read = ++store.depositReads;
  try {
    const logs = await wallet.vaultDeposits();
    if (logs === null) return;
    const receipts = await store.deps.client.history(address, { kind: "custody_deposit_changed", limit: RECEIPTS });
    if (store.liveWallet !== wallet || store.depositReads !== read) return;
    const known = new Set(receipts.events.flatMap((e) => (e.type === "custody_deposit_changed" ? [String(e.receipt.deposit_id)] : [])));
    const waiting = logs.filter((log) => !known.has(log.id) && !store.creditedDeposits.has(log.id));
    const sent = store.getSnapshot().pendingDeposits;
    // A deposit just sent that the vault's events do not show yet stays, since a provider may lag its receipt. One they show takes their id, from an event no other line holds; one the stream credited before it was noted goes.
    const taken = new Set([...sent.flatMap((d) => (d.id === null ? [] : [d.id])), ...known]);
    const claimed = new Set<VaultDeposit>();
    const unshown = sent.filter((d) => {
      if (d.id !== null) return false;
      const match = logs.find((log) => log.amount === d.amount && !claimed.has(log) && (waiting.includes(log) ? !taken.has(log.id) : store.creditedDeposits.has(log.id)));
      if (match !== undefined) claimed.add(match);
      return match === undefined;
    });
    store.patch({ pendingDeposits: [...waiting.map((log): PendingDeposit => ({ id: log.id, amount: log.amount })), ...unshown] });
  } catch {
    // A hint only: the line stays as it was.
  }
}

/** The account's deposit events the stream carried: a custody receipt names the vault's id, and a credit names an amount. Each takes its deposit off the list. */
export function creditDeposits(store: ConsoleStore, events: readonly EngineEvent[], account: string): void {
  let pending = store.getSnapshot().pendingDeposits;
  const before = pending;
  const drop = (at: number) => { if (at >= 0) pending = pending.filter((_, i) => i !== at); };
  for (const event of events) {
    if (event.type === "custody_deposit_changed" && event.receipt.beneficiary.kind === "trader" && event.receipt.beneficiary.account.toLowerCase() === account) {
      const id = String(event.receipt.deposit_id);
      const first = !store.creditedDeposits.has(id);
      store.creditedDeposits.add(id);
      const named = pending.findIndex((d) => d.id === id);
      // Only a receipt's first sight of an id may take a deposit not yet named; its later finality or reversal is the same deposit's.
      drop(named >= 0 || !first ? named : pending.findIndex((d) => d.id === null && sameAmount(d.amount, event.receipt.amount)));
    } else if (event.type === "deposited" && event.account.toLowerCase() === account) {
      // A node that sends no custody receipt, such as the mock, credits by amount alone.
      drop(pending.findIndex((d) => d.id === null && sameAmount(d.amount, event.amount)));
    }
  }
  if (pending !== before) store.patch({ pendingDeposits: pending });
}
