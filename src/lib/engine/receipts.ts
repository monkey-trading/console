/** Waiting for a sent transaction: polling its receipt through the provider until the chain mines it. */

/**
 * A dev build's word on a transaction that has not mined: null while it is not stuck; else whether
 * the console moved the account past its nonce, left from an earlier chain, or why it could not
 * (monkey-trading/console#291, #304).
 */
export type StuckVerdict = null | { moved: true } | { moved: false; why: string };

/** What a transaction the console moved past is told: the wallet's next send mines. */
export const MOVED_PAST = "Your wallet still had a transaction from an earlier chain. The console moved past it on this local chain; send it again.";

/** What a transaction stuck behind a nonce left from an earlier chain is told when the console could not move past it, and `why`. */
export function staleNonceText(why: string): string {
  return `Your wallet still has transactions from an earlier chain, so this one waits behind them and will not be mined. The console could not move past it, as ${why}. Clear your wallet's activity data for this network, then try again.`;
}

/** How often, and how many times, a transaction's receipt is polled. */
const RECEIPT_POLL_MS = 1_000;
const RECEIPT_POLLS = 180;

/**
 * Polls `receiptOf` for `hash` until the chain answers a receipt, and refuses one that reverted. The
 * polls bound how long a sent transaction may wait for the chain before the caller is told to check
 * their wallet. `stuck`, a dev build's, says from the second poll on whether it waits behind a nonce
 * the chain has not reached, which no wait would end, and whether the console moved past it.
 * Error cases:
 * - a receipt cannot be read
 * - the transaction reverted
 * - it stays pending through every poll, or is stuck behind a nonce from an earlier chain, moved past or not
 */
export async function waitMined(receiptOf: (hash: string) => Promise<unknown>, hash: string, action: string, wait: (ms: number) => Promise<void>, stuck?: () => Promise<StuckVerdict>): Promise<void> {
  const unconfirmed = (why: string) => new Error(`The transaction to ${action} was sent (${hash}) but ${why}. Check it in your wallet before trying again.`);
  for (let poll = 0; poll < RECEIPT_POLLS; poll++) {
    let receipt: unknown;
    try {
      receipt = await receiptOf(hash);
    } catch (error) {
      throw unconfirmed(`its receipt could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    // No receipt yet is null; a mined one carries its status.
    const status = typeof receipt === "object" && receipt !== null && "status" in receipt ? receipt.status : undefined;
    if (status !== undefined) {
      if (Number(status) !== 1) throw new Error(`The transaction to ${action} failed on chain (${hash}).`);
      return;
    }
    const verdict = poll > 0 && stuck !== undefined ? await stuck() : null;
    if (verdict !== null) throw new Error(verdict.moved ? MOVED_PAST : staleNonceText(verdict.why));
    await wait(RECEIPT_POLL_MS);
  }
  throw unconfirmed("is not confirmed yet");
}
