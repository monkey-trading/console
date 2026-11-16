/**
 * The one line across the app that says when the server has a problem (monkey-trading/console#398):
 * the connection to it lost, a server that cannot currently be verified, trading suspended by the
 * server, or open markets with no live price. Each clears by itself once the server says it has recovered.
 */

import type { FeedStatus } from "./engine/attestation";
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
];

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
function reasonWords(reasons: ReadonlySet<UnpricedReason>): string {
  const [only] = reasons;
  if (reasons.size !== 1 || only === undefined) return "the server is not currently receiving reliable prices";
  switch (only) {
    case "too_few_sources":
      return "the server is not currently receiving enough up-to-date prices";
    case "diverging":
      return "the prices received from different price feeds currently disagree";
    case "out_of_range":
      return "the underlying futures price is outside its permitted range";
    default:
      only satisfies never;
      return "the server is not currently receiving reliable prices";
  }
}

/** Which open markets have no live price, and why: the venues that quote them and report a problem, or else the server's reason. */
function pricesLine({ unpriced_markets: unpriced, venues }: ServerStatus): Omit<ServerLine, "role"> {
  const ids = new Set(unpriced.map((m) => m.market));
  const symbols = unpriced.map((m) => m.symbol);
  const markets = symbols.length > NAMED_MARKETS + 1 ? `${symbols.slice(0, NAMED_MARKETS).join(", ")} and ${symbols.length - NAMED_MARKETS} other markets` : andList(symbols);
  const causes = FAILING.flatMap(([state, words]) => {
    const names = venues.filter((v) => v.symbols.some((s) => s.state === state && ids.has(s.market))).map((v) => venueName(v.venue));
    return names.length === 0 ? [] : [words(andList(names), names.length > 1)];
  });
  const why = causes.length > 0 ? andList(causes) : reasonWords(new Set(unpriced.map((m) => m.reason)));
  const one = unpriced.length === 1;
  return { lead: `Live prices for ${markets} are temporarily unavailable because ${why}.`, rest: `Trading in ${one ? "this market" : "these markets"} will resume automatically once prices return.` };
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
  return server.status.unpriced_markets.length === 0 ? null : { role: "status", ...pricesLine(server.status) };
}
