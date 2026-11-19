/**
 * The one line across the app that says when the server has a problem (monkey-trading/console#398):
 * the connection to it lost, a server that cannot currently be verified, trading suspended by the
 * server, or open markets with no live price. Each clears by itself once the server says it has recovered;
 * a market no feed prices, which nothing but its operator can change, is not on it.
 */

import type { FeedStatus } from "./engine/attestation";
import type { FollowStatus } from "./engine/operator-follow-status";
import type { PauseView } from "./store/trading-pause";
import { LONG_PAUSE, PAUSE_TITLE, RESUMES_WHEN } from "./trading-pause-words";
import type { HoldCause, ServerRead, ServerStatus, UnpricedReason, VenueState } from "./engine/status-types";
import { asSentence } from "./format";

/** `alert` while all trading is suspended, `status` while only some markets are. */
export interface ServerLine {
  role: "alert" | "status";
  lead: string;
  rest: string;
}

/** The price feeds' names as traders know them, by the server's name for each. */
const VENUE_NAMES: Readonly<Record<string, string>> = { bitstamp: "Bitstamp", cme: "CME Group", coinbase: "Coinbase", kraken: "Kraken", massive: "Massive", tradermade: "TraderMade" };

/** The states that stop a venue's prices counting, worst news first, each with how it reads after "because". */
const FAILING: readonly [VenueState, (names: string, many: boolean) => string][] = [
  ["down", (names) => `the server has lost its connection to ${names}`],
  ["delayed", (names) => `the prices received from ${names} are delayed`],
  ["silent", (names, many) => `${names} ${many ? "are" : "is"} not currently sending prices`],
  ["off", (names) => `the server is not currently connected to ${names}`],
  ["stale", (names) => `the prices received from ${names} are out of date`],
];

/** The states in which a venue cannot quote a market until the server's operator acts: its connection withheld, or no quotes taken from it. */
const UNFED: ReadonlySet<VenueState> = new Set(["off", "not_expected"]);

/** Markets named in full before the rest are counted. */
const NAMED_MARKETS = 3;

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function venueName(venue: string): string {
  return VENUE_NAMES[venue] ?? `${venue.charAt(0).toUpperCase()}${venue.slice(1)}`;
}

/** Why trading is suspended, with what ends it. */
function holdLine(cause: HoldCause): Omit<ServerLine, "role"> {
  switch (cause) {
    case "trusted_time":
      return { lead: "Trading has been suspended because the server cannot currently confirm the correct time.", rest: "Trading will resume automatically once the time has been confirmed." };
    case "log_sync_held":
      return { lead: "Trading has been suspended while the server finishes saving its record of recent trading.", rest: "Trading will resume automatically once the record has been saved." };
    case "log_rollback":
      return { lead: "Trading has been suspended because the server's record of trading does not match the record it previously published.", rest: "Trading will resume once the server's operator has investigated and restarted the server." };
    default:
      // A cause from a newer server than this app knows.
      cause satisfies never;
      return { lead: "Trading has been suspended by the server.", rest: "Trading will resume once the server is able to accept orders again." };
  }
}

/** Why no price forms when no venue that quotes the market reports a problem. */
function reasonWords(reason: UnpricedReason): string {
  switch (reason) {
    case "too_few_sources":
      return "the server is not currently receiving enough up-to-date prices";
    case "diverging":
      return "the prices received from different price feeds currently disagree";
    case "out_of_range":
      return "the underlying futures price is outside its permitted range";
    default:
      // A reason from a newer server than this app knows.
      reason satisfies never;
      return "the server is not currently receiving reliable prices";
  }
}

/** Why one market has no price: the venues that quote it and report a problem, or else the server's reason; `venue` says which. */
function causeOf(market: ServerStatus["unpriced_markets"][number], venues: ServerStatus["venues"]): { why: string; venue: boolean } {
  const causes = FAILING.flatMap(([state, words]) => {
    const names = venues.filter((v) => v.symbols.some((s) => s.state === state && s.market === market.market)).map((v) => venueName(v.venue));
    return names.length === 0 ? [] : [words(andList(names), names.length > 1)];
  });
  return causes.length > 0 ? { why: andList(causes), venue: true } : { why: reasonWords(market.reason), venue: false };
}

/**
 * Whether as many venues as `market`'s price needs quote it, or will once they recover: false for a market
 * no feed prices (the engine's `market_unfed`), such as a dev node's markets beyond crypto, or a vendor's
 * before its key is delivered.
 */
function fed(market: ServerStatus["unpriced_markets"][number], venues: ServerStatus["venues"]): boolean {
  return venues.filter((v) => v.symbols.some((s) => s.market === market.market && !UNFED.has(s.state))).length >= market.min_sources;
}

/** The markets of one cause, the first three named and the rest counted. */
function marketWords(symbols: readonly string[]): string {
  return symbols.length > NAMED_MARKETS + 1 ? `${symbols.slice(0, NAMED_MARKETS).join(", ")} and ${symbols.length - NAMED_MARKETS} other markets` : andList(symbols);
}

/** Which open markets have no live price and why, one sentence per cause, those a venue explains first. */
function pricesLine({ unpriced_markets: unpriced, venues }: ServerStatus): Omit<ServerLine, "role"> {
  const groups = new Map<string, { venue: boolean; symbols: string[] }>();
  for (const market of unpriced) {
    const { why, venue } = causeOf(market, venues);
    const group = groups.get(why) ?? { venue, symbols: [] };
    group.symbols.push(market.symbol);
    groups.set(why, group);
  }
  const [lead = "", ...others] = [...groups].sort(([, a], [, b]) => Number(b.venue) - Number(a.venue)).map(([why, { symbols }]) => `Live prices for ${marketWords(symbols)} are temporarily unavailable because ${why}.`);
  const one = unpriced.length === 1;
  return { lead, rest: [...others, `Trading in ${one ? "this market" : "these markets"} will resume automatically once prices return.`].join(" ") };
}

/**
 * The line for the server's state, or null while nothing is wrong. A stale stream comes first, as what
 * the server said before it is no longer current: an unsigned answer since says it cannot currently be
 * verified, no answer that it cannot be reached, and otherwise `reason` says why the stream stopped.
 */
export function serverLine(stream: FeedStatus, server: ServerRead | null, reason: string | null): ServerLine | null {
  if (stream === "stale") {
    if (server?.kind === "unsigned") return { role: "alert", lead: "The trading server cannot currently be verified, so trading has been suspended.", rest: "Trading will resume automatically once the server can be verified again." };
    if (server?.kind === "unreachable") return { role: "alert", lead: "The connection to the trading server has been lost, so trading has been suspended.", rest: "The app will reconnect automatically, and trading will resume once the connection is restored." };
    return { role: "alert", lead: "Live prices are not currently updating, so trading has been suspended.", rest: `Trading will resume automatically once the price feed recovers.${reason === null ? "" : ` ${asSentence(reason)}`}` };
  }
  if (server?.kind !== "signed") return null;
  const hold = server.status.holds[0];
  if (hold !== undefined) return { role: "alert", ...holdLine(hold.cause) };
  const outage = server.status.unpriced_markets.filter((m) => fed(m, server.status.venues));
  return outage.length === 0 ? null : { role: "status", ...pricesLine({ ...server.status, unpriced_markets: outage }) };
}

/**
 * The one line while the console moves to the server the operator runs on with trading not paused, as when a page load finds it elsewhere,
 * or null when no move is under way: a calm status while that server is checked or has not yet answered, and an alert once it answered
 * and failed its check, when the console stays off it. While it shows, nothing said of the server being left applies.
 */
export function switchLine(follow: FollowStatus | null): ServerLine | null {
  if (follow?.kind !== "waiting") return null;
  const why = follow.reason === null ? "" : ` ${asSentence(follow.reason)}`;
  // Why it was refused is the verifier's internal detail, which an error does not chain on.
  if (follow.stage === "refused") return { role: "alert", lead: "The current trading server could not be verified, so the app has not connected to it.", rest: "The app will try again automatically." };
  return { role: "status", lead: "Connecting to the current trading server.", rest: `Trading will be available once the server has been verified.${why}` };
}

/** The one line on a page without the trading view while trading is paused for a change of trading server, or null once it has resumed; the pause's own live region announces it. */
export function pauseLine(view: PauseView): ServerLine | null {
  if (view.kind !== "paused") return null;
  if (view.failure !== null) return { role: "alert", lead: `${PAUSE_TITLE}.`, rest: view.failure };
  return { role: "status", lead: `${PAUSE_TITLE}.`, rest: view.long ? LONG_PAUSE : RESUMES_WHEN };
}
