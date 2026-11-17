/**
 * Whether a market has a live price and, when it has none, why, from the pricing the server serves
 * with each market (monkey-trading/console#385): the words the deal ticket, the market list, the chart
 * and a refused order share.
 */

import type { MarketPricing, SourceState } from "./engine/pricing-types";
import { asSentence } from "./format";
import type { MarketModel } from "./models";

/** The price feeds' names as traders know them, by the server's name for each. */
const SOURCE_NAMES: Readonly<Record<string, string>> = { bitstamp: "Bitstamp", cme: "CME Group", coinbase: "Coinbase", kraken: "Kraken", massive: "Massive", tradermade: "TraderMade" };

/** Each state that keeps a source's price out of the index, worst news first, with how it reads after "because". */
const NOT_COUNTING: readonly [SourceState, (names: string, many: boolean) => string][] = [
  ["down", (names) => `the server has lost its connection to ${names}`],
  ["delayed", (names) => `the prices received from ${names} are delayed`],
  ["silent", (names, many) => `${names} ${many ? "are" : "is"} not currently sending prices`],
  ["off", (names) => `the server is not currently connected to ${names}`],
  ["stale", (names, many) => `the latest ${many ? "prices" : "price"} from ${names} ${many ? "are" : "is"} out of date`],
  ["never_quoted", (names, many) => `the server is waiting for the first ${many ? "prices" : "price"} from ${names}`],
];

/**
 * The states in which a source cannot price a market until the server's operator acts: withheld, or taking no
 * quotes for it. A connected source that has not yet quoted (`never_quoted`) is waiting for its first price, and
 * the server reports it `silent` once its connection has gone the silence timeout without one.
 */
const UNFED: ReadonlySet<SourceState> = new Set(["off", "not_expected"]);

/** What the deal ticket and a refused order tell a trader of a market no feed prices on this server. */
export const UNFED_TEXT = "Live prices for this market are not available on this server, so it cannot be traded.";

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** The sources of `pricing` in `state`, by name. */
function named(pricing: MarketPricing, state: SourceState): string[] {
  return pricing.sources.filter((s) => s.state === state).map((s) => SOURCE_NAMES[s.source] ?? `${s.source.charAt(0).toUpperCase()}${s.source.slice(1)}`);
}

/** Each market status as the market list and the chart label it. */
export const STATUS_LABELS = { open: "Open", closed: "Closed", unpriced: "No live price", unfed: "Not available on this server" } as const;

/** Whether the market has a live price: the server's word where it serves one, else whether it has ever had a mark. */
export function isPriced(market: MarketModel): boolean {
  return market.view.pricing?.priced ?? market.mark !== null;
}

/**
 * Whether no feed prices a market with `pricing` on this server (the engine's `market_unfed`): fewer of its
 * sources than its price needs could ever count without the operator acting, as for a dev node's markets
 * beyond crypto, or a vendor's before its key is delivered. Such a market does not recover by itself.
 */
export function isUnfed(pricing: MarketPricing | undefined): boolean {
  return pricing !== undefined && !pricing.priced && pricing.sources.filter((s) => !UNFED.has(s.state)).length < pricing.min_sources;
}

/** What the market list and the chart say of a market; a closed market holds no price either, and stays closed. */
export function marketStatus(market: MarketModel): "open" | "closed" | "unpriced" | "unfed" {
  if (!market.open) return "closed";
  if (isPriced(market)) return "open";
  return isUnfed(market.view.pricing) ? "unfed" : "unpriced";
}

/** Why a market with `pricing` has no price, as a clause that follows "because"; null while it is priced, or from a server that does not say. */
export function unpricedWhy(pricing: MarketPricing | undefined): string | null {
  if (pricing === undefined || pricing.priced) return null;
  if (pricing.unpriced === "out_of_range") return "the underlying futures price is outside its permitted range";
  if (pricing.unpriced === "diverging") {
    const names = named(pricing, "diverging");
    return `the prices received from ${names.length < 2 ? "different price feeds" : andList(names)} currently disagree`;
  }
  const causes = NOT_COUNTING.flatMap(([state, words]) => {
    const names = named(pricing, state);
    return names.length === 0 ? [] : [words(andList(names), names.length > 1)];
  });
  return causes.length > 0 ? andList(causes) : "the server is not currently receiving enough up-to-date prices";
}

/** An order refused for want of a price, naming why where `pricing` says. */
export function noPriceRefusal(pricing: MarketPricing | undefined): string {
  if (isUnfed(pricing)) return UNFED_TEXT;
  const why = unpricedWhy(pricing);
  return `No live price is currently available for this market${why === null ? "" : ` because ${why}`}.`;
}

/** A close-all entry refused for want of a price, naming the market and why where `pricing` says. */
export function noPriceClose(symbol: string, pricing: MarketPricing | undefined): string {
  if (isUnfed(pricing)) return `The ${symbol} position was not closed, because live prices for its market are not available on this server.`;
  const why = unpricedWhy(pricing);
  return `The ${symbol} position was not closed, because no live price is currently available for its market.${why === null ? "" : ` ${asSentence(why)}`}`;
}
