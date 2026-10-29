/** Follows what the node streams for the connected account besides its log: executable quotes and withdrawal authorizations. */

import type { ClientEvent } from "../engine/client";
import type { MarketQuote, SignedWithdrawal } from "../engine/types";
import { quoteMarkets } from "../quotes";
import type { ConsoleState } from "./state";
import type { ConsoleStore } from "./store";

/** The state after a quote, a refused quote request, or an authorization arrives; null when the event changes nothing. */
export function applyFeedEvent(state: ConsoleState, event: ClientEvent): Partial<ConsoleState> | null {
  const mine = state.wallet?.address.toLowerCase();
  if (event.type === "quote") {
    if (event.quote.account.toLowerCase() !== mine) return null;
    return { quotes: { ...state.quotes, [event.quote.market]: event.quote }, quoteError: null };
  }
  if (event.type === "quote_error") return mine === undefined ? null : { quotes: {}, quoteError: event.error };
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

/** Asks the node for the connected account's quotes in the selected market and those it holds, or for none without a wallet. */
export function syncQuotes(store: ConsoleStore): void {
  const { wallet, selected, account } = store.getSnapshot();
  const held = account?.positions.map((p) => p.market) ?? [];
  store.deps.client.quotes(wallet === null ? null : { account: wallet.address, markets: quoteMarkets(selected, held) });
}

/** The quote for `market`, when the node has sent one for the connected account. */
export function quoteFor(state: ConsoleState, market: number): MarketQuote | null {
  return state.quotes[market] ?? null;
}

/** The connected account's authorization for payout `nonce`, when the stream or a search found it. */
export function authorizationFor(state: ConsoleState, nonce: number): SignedWithdrawal | null {
  return state.authorizations.find((w) => w.nonce === nonce) ?? null;
}
