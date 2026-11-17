/** Tests for the app-wide server line: a venue down, a market no feed prices, trading suspended, a lost connection, an unverifiable server, and recovery. */

import { describe, expect, it } from "vitest";

import type { HoldCause, ServerRead, ServerStatus, UnpricedReason, VenueState } from "./engine/status-types";
import { serverLine } from "./server-status";

const HEALTHY: ServerStatus = { as_of_ms: 1, takes_orders: true, holds: [], trusted_time: { state: "sampled", last_sample_ms: 1 }, venues: [], unpriced_markets: [] };

/** A venue on one connection quoting `markets` (id and symbol) in `state`. */
const venue = (name: string, state: VenueState, ...markets: [number, string][]) => ({ venue: name, connections: 1, state, symbols: markets.map(([market, symbol]) => ({ symbol, market, state })) });
const unpriced = (market: number, symbol: string, reason: UnpricedReason = "too_few_sources", minSources = 2) => ({ market, symbol, reason, fresh_sources: 1, min_sources: minSources });
const signed = (status: Partial<ServerStatus>): ServerRead => ({ kind: "signed", status: { ...HEALTHY, ...status } });
const BTC: [number, string] = [1, "BTC-USD"];
const ETH: [number, string] = [2, "ETH-USD"];

describe("markets without a live price", () => {
  it("names the markets and the venue the server has lost, and says trading resumes by itself", () => {
    const server = signed({ venues: [venue("coinbase", "down", BTC, ETH), venue("kraken", "quoting", BTC, ETH)], unpriced_markets: [unpriced(...BTC), unpriced(...ETH)] });
    expect(serverLine("live", server, null)).toEqual({
      role: "status",
      lead: "Live prices for BTC-USD and ETH-USD are temporarily unavailable because the server has lost its connection to Coinbase.",
      rest: "Trading in these markets will resume automatically once prices return.",
    });
  });

  it.each([
    ["a delayed venue", [venue("kraken", "delayed", BTC)], "the prices received from Kraken are delayed"],
    ["a silent venue", [venue("bitstamp", "silent", BTC)], "Bitstamp is not currently sending prices"],
    ["two silent venues", [venue("coinbase", "silent", BTC), venue("kraken", "silent", BTC)], "Coinbase and Kraken are not currently sending prices"],
    ["a venue the server is not connected to beside one it has lost", [venue("tradermade", "off", BTC), venue("massive", "down", BTC)], "the server has lost its connection to Massive and the server is not currently connected to TraderMade"],
    ["a venue whose prices are too old to count", [venue("coinbase", "stale", BTC)], "the prices received from Coinbase are out of date"],
    ["a venue down and another delayed", [venue("kraken", "delayed", BTC), venue("coinbase", "down", BTC)], "the server has lost its connection to Coinbase and the prices received from Kraken are delayed"],
    ["a venue this app has no name for", [venue("newvenue", "down", BTC)], "the server has lost its connection to Newvenue"],
    ["a venue down for another market only", [venue("coinbase", "down", ETH), venue("kraken", "quoting", BTC)], "the server is not currently receiving enough up-to-date prices"],
  ])("says why for %s, in one market", (_, venues, why) => {
    // A market priced from one venue, so each case's venues are enough to price it once they recover.
    expect(serverLine("live", signed({ venues, unpriced_markets: [unpriced(...BTC, "too_few_sources", 1)] }), null)).toEqual({
      role: "status", lead: `Live prices for BTC-USD are temporarily unavailable because ${why}.`, rest: "Trading in this market will resume automatically once prices return.",
    });
  });

  it.each([
    ["diverging", "the prices received from different price feeds currently disagree"],
    ["out_of_range", "the underlying futures price is outside its permitted range"],
  ] as const)("gives the server's reason, %s, when no venue reports a problem", (reason, why) => {
    const venues = [venue("coinbase", "quoting", [1, "M1"]), venue("kraken", "quoting", [1, "M1"])];
    expect(serverLine("live", signed({ venues, unpriced_markets: [unpriced(1, "M1", reason)] }), null)?.lead).toBe(`Live prices for M1 are temporarily unavailable because ${why}.`);
  });

  it("gives each market only its own cause, one sentence per cause, those a venue explains first", () => {
    const XAU: [number, string] = [11, "XAU-USD"];
    const server = signed({
      venues: [venue("coinbase", "quoting", BTC, ETH), venue("kraken", "down", BTC, ETH), venue("massive", "quoting", XAU), venue("tradermade", "quoting", XAU)],
      unpriced_markets: [unpriced(...BTC), unpriced(...ETH), unpriced(...XAU, "diverging")],
    });
    expect(serverLine("live", server, null)).toEqual({
      role: "status",
      lead: "Live prices for BTC-USD and ETH-USD are temporarily unavailable because the server has lost its connection to Kraken.",
      rest: "Live prices for XAU-USD are temporarily unavailable because the prices received from different price feeds currently disagree. Trading in these markets will resume automatically once prices return.",
    });
  });

  it("names a market whose connected venues have not yet quoted as the server starts, as one that resumes by itself", () => {
    // The status read reports a connected venue's symbol as quoting until its first quote reaches the engine.
    const server = signed({ venues: [venue("coinbase", "quoting", BTC), venue("kraken", "quoting", BTC)], unpriced_markets: [{ ...unpriced(...BTC), fresh_sources: 0 }] });
    expect(serverLine("live", server, null)).toEqual({
      role: "status",
      lead: "Live prices for BTC-USD are temporarily unavailable because the server is not currently receiving enough up-to-date prices.",
      rest: "Trading in this market will resume automatically once prices return.",
    });
  });

  it("names four markets in full, and counts the rest past three", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i): [number, string] => [i + 1, `M${i + 1}`]);
    const markets = (n: number) => signed({ venues: [venue("coinbase", "down", ...ids(n)), venue("kraken", "quoting", ...ids(n))], unpriced_markets: ids(n).map((m) => unpriced(...m)) });
    expect(serverLine("live", markets(4), null)?.lead).toMatch(/^Live prices for M1, M2, M3 and M4 are/);
    expect(serverLine("live", markets(6), null)?.lead).toMatch(/^Live prices for M1, M2, M3 and 3 other markets are/);
  });
});

describe("a venue on two connections", () => {
  // Coinbase over Advanced Trade and Exchange, as the server reports it: one venue, and each symbol in
  // the best state either connection reports, so `down` only while both are.
  const coinbase = (state: VenueState): ServerStatus["venues"][number] => ({ ...venue("coinbase", state, BTC), connections: 2 });

  it("shows no line with one connection down, as the other still prices the market", () => {
    expect(serverLine("live", signed({ venues: [coinbase("quoting"), venue("kraken", "quoting", BTC)] }), null)).toBeNull();
  });

  it.each([
    ["one connection down, beside another venue down", "quoting", "down", "the server has lost its connection to Kraken"],
    ["both connections down", "down", "quoting", "the server has lost its connection to Coinbase"],
  ] as const)("names Coinbase once, and only while neither connection quotes the market, with %s", (_, coinbaseState, krakenState, why) => {
    const server = signed({ venues: [coinbase(coinbaseState), venue("kraken", krakenState, BTC)], unpriced_markets: [unpriced(...BTC)] });
    expect(serverLine("live", server, null)?.lead).toBe(`Live prices for BTC-USD are temporarily unavailable because ${why}.`);
  });
});

describe("a market no feed prices", () => {
  it.each([
    // A dev node lists EUR-USD with no venue to quote it.
    ["no venue that quotes it", []],
    // A vendor's markets before its key is delivered.
    ["venues whose connections are withheld", [venue("massive", "off", [10, "EUR-USD"]), venue("tradermade", "off", [10, "EUR-USD"])]],
    ["fewer venues that can quote it than its price needs", [venue("massive", "off", [10, "EUR-USD"]), venue("tradermade", "down", [10, "EUR-USD"])]],
    ["venues that take no quotes for it", [venue("cme", "not_expected", [10, "EUR-USD"]), venue("massive", "quoting", [10, "EUR-USD"])]],
  ] as [string, ReturnType<typeof venue>[]][])("is left off the line for %s, as nothing but the server's operator changes it", (_, venues) => {
    expect(serverLine("live", signed({ venues, unpriced_markets: [unpriced(10, "EUR-USD")] }), null)).toBeNull();
  });

  it("is left off the line while the markets a venue outage stops are named", () => {
    // A dev node with live venues and Kraken cut: EUR-USD has no venue at all.
    const server = signed({ venues: [venue("coinbase", "quoting", BTC, ETH), venue("kraken", "down", BTC, ETH)], unpriced_markets: [unpriced(...BTC), unpriced(...ETH), unpriced(10, "EUR-USD")] });
    expect(serverLine("live", server, null)).toEqual({
      role: "status",
      lead: "Live prices for BTC-USD and ETH-USD are temporarily unavailable because the server has lost its connection to Kraken.",
      rest: "Trading in these markets will resume automatically once prices return.",
    });
  });
});

describe("trading suspended by the server", () => {
  it.each([
    ["trusted_time", "Trading has been suspended because the server cannot currently confirm the correct time.", "Trading will resume automatically once the time has been confirmed."],
    ["log_sync_held", "Trading has been suspended while the server finishes saving its record of recent trading.", "Trading will resume automatically once the record has been saved."],
    ["log_rollback", "Trading has been suspended because the server's record of trading does not match the record it previously published.", "Trading will resume once the server's operator has investigated and restarted the server."],
    ["a_newer_cause", "Trading has been suspended by the server.", "Trading will resume once the server is able to accept orders again."],
  ])("says why for %s, ahead of any market without a price", (cause, lead, rest) => {
    // A cause from a newer server reaches the app as any other string.
    const server = signed({ takes_orders: false, holds: [{ cause: cause as HoldCause, since_ms: 1 }], unpriced_markets: [unpriced(...BTC)] });
    expect(serverLine("live", server, null)).toEqual({ role: "alert", lead, rest });
  });
});

describe("a stream that has stopped", () => {
  it.each([
    ["an unsigned answer", { kind: "unsigned" }, "The trading server cannot currently be verified, so trading has been suspended.", "Trading will resume automatically once the server can be verified again."],
    ["no answer", { kind: "unreachable" }, "The connection to the trading server has been lost, so trading has been suspended.", "The app will reconnect automatically, and trading will resume once the connection is restored."],
    ["nothing read yet", null, "Live prices are not currently updating, so trading has been suspended.", "Trading will resume automatically once the price feed recovers. The connection to the server was closed."],
    ["a signed answer from before", signed({ unpriced_markets: [unpriced(...BTC)] }), "Live prices are not currently updating, so trading has been suspended.", "Trading will resume automatically once the price feed recovers. The connection to the server was closed."],
  ] as const)("after %s, says so first", (_, server, lead, rest) => {
    expect(serverLine("stale", server, "The connection to the server was closed.")).toEqual({ role: "alert", lead, rest });
  });
});

describe("recovery", () => {
  it.each([
    ["a signed state with nothing wrong", "live", signed({ venues: [venue("coinbase", "quoting", BTC)] })],
    ["a stream back after an unsigned answer", "live", { kind: "unsigned" }],
    ["a stream back after no answer", "live", { kind: "unreachable" }],
    ["a node that says nothing of its state", "live", null],
    ["a stream still connecting", "connecting", { kind: "unsigned" }],
  ] as const)("shows no line for %s", (_, stream, server) => {
    expect(serverLine(stream, server, null)).toBeNull();
  });
});
