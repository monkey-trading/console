/** Cancel all and close all (engine V44): one wallet-or-session signature and one request each, never a loop over the single actions. */

import { describeCancelAll, describeCloseAll, closeAllOutcome } from "../batch-result";
import { EngineError, type ActionResult } from "../engine/client";
import { cancelAllTypedData, closeAllTypedData } from "../engine/eip712";
import type { MarketId } from "../engine/types";
import type { CloseTarget } from "../close-all";
import { fixedToWire } from "../fixed";
import { sessionSigned } from "./session";
import { domainOf } from "./signing";
import type { ConsoleStore } from "./store";

/** A node that predates the route answers 404 (one on an earlier protocol answers `batch_unsupported`), and nothing was sequenced or spent a nonce. */
async function ifSupported(action: string, send: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await send();
  } catch (error) {
    if (error instanceof EngineError && error.status === 404) throw new EngineError(404, `This node does not support ${action} yet. It needs to restart onto a newer version.`, null, { cause: error });
    throw error;
  }
}

/**
 * Cancels every resting order of the account, in every market, on one request. A copy that ran
 * first leaves nothing more to cancel, so a stale nonce is signed again as a single cancel's is.
 */
export async function cancelAll(store: ConsoleStore): Promise<void> {
  const count = store.getSnapshot().account?.orders.length ?? 0;
  if (count === 0) return;
  const out = await sessionSigned(store, `cancel all ${count} resting ${count === 1 ? "order" : "orders"}`, (t, account) => cancelAllTypedData(domainOf(store), { account }, t), (auth, wallet) =>
    ifSupported("cancel all", () => store.deps.client.cancelAll({ account: wallet.address, auth })), "sign-again",
  );
  if (!out.ok) return;
  const { tone, text } = describeCancelAll(out.result.events);
  store.toast(tone, text);
  await store.refresh(true);
}

/**
 * Closes each target's whole position on one request, every entry with the price the caller
 * quoted and one slippage bound. A stale nonce is reported, not signed again: a copy may have run.
 * An empty list sends nothing.
 */
export async function closeAll(store: ConsoleStore, targets: readonly CloseTarget[], slippageBps: number): Promise<void> {
  if (targets.length === 0) return;
  const symbolOf = (market: MarketId) => store.getSnapshot().markets.find((m) => m.id === market)?.symbol ?? String(market);
  const closes = targets.map((t) => ({ market: t.market, quoted: fixedToWire(t.quoted) }));
  const summary = `close ${targets.length === 1 ? "1 position" : `${targets.length} positions`} (${targets.map((t) => symbolOf(t.market)).join(", ")}), up to ${slippageBps} bps worse each`;
  const out = await sessionSigned(store, summary, (t, account) => closeAllTypedData(domainOf(store), { account, closes, max_slippage_bps: slippageBps }, t), (auth, wallet) =>
    ifSupported("close all", () => store.deps.client.closeAll({ account: wallet.address, closes, max_slippage_bps: slippageBps, auth })), "report",
  );
  if (!out.ok) return;
  const { tone, text } = describeCloseAll(closeAllOutcome(targets.map((t) => t.market), out.result.events), symbolOf);
  store.toast(tone, text);
  await store.refresh(true);
}
