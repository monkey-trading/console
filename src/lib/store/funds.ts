/** Follows what the node streams for the connected account besides its log: executable quotes and withdrawal authorizations. */

import type { ClientEvent } from "../engine/client";
import type { SignedWithdrawal } from "../engine/types";
import { quoteMarkets } from "../quotes";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

/** The state after a quote, a refused quote request, or an authorization arrives; null when the event changes nothing. */
export function applyFeedEvent(state: ConsoleState, event: ClientEvent): Partial<ConsoleState> | null {
  const mine = state.wallet?.address.toLowerCase();
  if (event.type === "quote") {
    // A quote for a market the console no longer asks about may be stale, so it is not kept.
    if (event.quote.account.toLowerCase() !== mine || !state.quoted.includes(event.quote.market)) return null;
    return { quotes: { ...state.quotes, [event.quote.market]: event.quote }, quoteError: null };
  }
  if (event.type === "quote_error") return mine === undefined ? null : { quotes: {}, quoteError: event.error };
  // A quote from before an outage is not executable; the reconnected stream sends fresh ones.
  if (event.type === "feed" && event.status === "stale") return Object.keys(state.quotes).length === 0 ? null : { quotes: {} };
  if (event.type === "withdrawal") {
    const signed = event.withdrawal;
    if (signed.account.toLowerCase() !== mine || signed.authorization === undefined) return null;
    return { authorizations: [...state.authorizations.filter((w) => w.nonce !== signed.nonce), signed] };
  }
  return null;
}

/** Applies each quote and authorization the client reports to the store; returns the unsubscribe. */
export function followAccountFeeds(store: ConsoleStore): () => void {
  return store.deps.client.watch((event) => {
    const change = applyFeedEvent(store.getSnapshot(), event);
    if (change !== null) store.patch(change);
  });
}

/**
 * Asks the node for the connected account's quotes in the selected market and those it holds, or for
 * none without a wallet, and drops the quotes of markets it no longer asks about, which stop updating.
 */
export function syncQuotes(store: ConsoleStore): void {
  const { wallet, selected, account, quotes } = store.getSnapshot();
  const markets = wallet === null ? [] : quoteMarkets(selected, account?.positions.map((p) => p.market) ?? []);
  const kept = Object.fromEntries(Object.entries(quotes).filter(([market]) => markets.includes(Number(market))));
  store.patch({ quoted: markets, quotes: kept });
  store.deps.client.quotes(wallet === null ? null : { account: wallet.address, markets });
}

/** The connected account's authorization for payout `nonce`, when the stream or a search found it. */
export function authorizationFor(state: ConsoleState, nonce: number): SignedWithdrawal | null {
  return state.authorizations.find((w) => w.nonce === nonce) ?? null;
}
