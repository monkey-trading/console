/** Tests for a market's live price and why it has none: a lagging venue, a market no feed prices, a server waiting for its first prices, a closed market, recovery, and the refusals that name the reason. */

import { describe, expect, it } from "vitest";

import type { MarketPricing, SourceState } from "./engine/pricing-types";
import { decodeMarket } from "./models";
import { BTC } from "./store/live-kit";
import { isPriced, isUnfed, marketStatus, noPriceClose, noPriceRefusal, unpricedWhy } from "./unpriced";

const source = (name: string, state: SourceState) => ({ source: name, state, last_quote_ms: state === "never_quoted" ? null : 1, age_ms: state === "never_quoted" ? null : 0 });

/** BTC-USD's pricing with `sources`, unpriced for `unpriced` or priced without it. */
function pricing(sources: [string, SourceState][], unpriced?: MarketPricing["unpriced"]): MarketPricing {
  return { priced: unpriced === undefined, ...(unpriced === undefined ? {} : { unpriced }), as_of_ms: 1, fresh_sources: 1, min_sources: 2, sources: sources.map(([name, state]) => source(name, state)) };
}

/** BTC-USD with its last mark kept, open or not, with `pricing` as the server serves it or none. */
const market = (pricingNow: MarketPricing | undefined, open = true) => decodeMarket({ ...BTC, open, ...(pricingNow === undefined ? {} : { pricing: pricingNow }) }, undefined, false);

const LAGGING = pricing([["coinbase", "counts"], ["kraken", "delayed"]], "too_few_sources");

describe("whether a market has a live price", () => {
  it("takes the server's word over a mark it keeps while the market has no price, and recovers with it", () => {
    expect(isPriced(market(LAGGING))).toBe(false);
    expect(marketStatus(market(LAGGING))).toBe("unpriced");
    expect(marketStatus(market(pricing([["coinbase", "counts"], ["kraken", "counts"]])))).toBe("open");
  });

  it("keeps a closed market closed, though it holds no price either", () => {
    expect(marketStatus(market(pricing([["coinbase", "not_expected"]], "too_few_sources"), false))).toBe("closed");
  });

  it("reads a mark as a price from a server that does not say, and the mock", () => {
    expect(isPriced(market(undefined))).toBe(true);
    expect(isPriced(decodeMarket({ ...BTC, mark: null }, undefined, false))).toBe(false);
  });
});

describe("a market no feed prices on this server", () => {
  it.each([
    // A dev node lists EUR-USD with no venue to quote it.
    ["no source at all", [], true],
    // A vendor's markets before its key is delivered.
    ["sources whose connections are withheld", [["massive", "off"], ["tradermade", "off"]], true],
    ["fewer sources that can count than its price needs", [["coinbase", "counts"], ["kraken", "off"]], true],
    ["sources that take no quotes for it", [["cme", "not_expected"], ["massive", "counts"]], true],
    ["a source waiting for its first price beside one withheld", [["coinbase", "never_quoted"], ["kraken", "off"]], true],
    ["sources that can recover by themselves", [["coinbase", "counts"], ["kraken", "down"]], false],
    ["sources connected and waiting for their first price", [["coinbase", "never_quoted"], ["kraken", "never_quoted"]], false],
  ] as [string, [string, SourceState][], boolean][])("is told from an outage for %s", (_, sources, unfed) => {
    expect(isUnfed(pricing(sources, "too_few_sources"))).toBe(unfed);
    expect(marketStatus(market(pricing(sources, "too_few_sources")))).toBe(unfed ? "unfed" : "unpriced");
  });

  it("is never unfed while priced, closed, or from a server that does not say", () => {
    expect(isUnfed(pricing([]))).toBe(false);
    expect(isUnfed(undefined)).toBe(false);
    expect(marketStatus(market(pricing([], "too_few_sources"), false))).toBe("closed");
  });

  it("says plainly that it cannot be traded, without promising it resumes", () => {
    const unfed = pricing([], "too_few_sources");
    expect(noPriceRefusal(unfed)).toBe("Live prices for this market are not available on this server, so it cannot be traded.");
    expect(noPriceClose("EUR-USD", unfed)).toBe("The EUR-USD position was not closed, because live prices for its market are not available on this server.");
  });
});

describe("a server that has just started", () => {
  // Coinbase and Kraken are connected, and the engine holds no quote from either yet.
  const STARTING = { ...pricing([["coinbase", "never_quoted"], ["kraken", "never_quoted"]], "too_few_sources"), fresh_sources: 0 };

  it("reads a market whose connected venues have not yet quoted as waiting for a price, not as unavailable on the server", () => {
    expect(marketStatus(market(STARTING))).toBe("unpriced");
    expect(noPriceRefusal(STARTING)).toBe("No live price is currently available for this market because the server is waiting for the first prices from Coinbase and Kraken.");
    expect(noPriceClose("BTC-USD", STARTING)).toBe("The BTC-USD position was not closed, because no live price is currently available for its market. The server is waiting for the first prices from Coinbase and Kraken.");
  });

  it("names only the venue still to quote once the other has", () => {
    const half = pricing([["coinbase", "counts"], ["kraken", "never_quoted"]], "too_few_sources");
    expect(marketStatus(market(half))).toBe("unpriced");
    expect(unpricedWhy(half)).toBe("the server is waiting for the first price from Kraken");
  });
});

describe("unpricedWhy", () => {
  it.each([
    ["a lagging venue", [["coinbase", "counts"], ["kraken", "delayed"]], "the prices received from Kraken are delayed"],
    ["a venue the server lost", [["coinbase", "down"], ["kraken", "counts"]], "the server has lost its connection to Coinbase"],
    ["a silent venue", [["bitstamp", "silent"]], "Bitstamp is not currently sending prices"],
    ["two silent venues", [["coinbase", "silent"], ["kraken", "silent"]], "Coinbase and Kraken are not currently sending prices"],
    ["a venue the server is not connected to", [["tradermade", "off"]], "the server is not currently connected to TraderMade"],
    ["an out-of-date price", [["cme", "stale"]], "the latest price from CME Group is out of date"],
    ["two out-of-date prices", [["coinbase", "stale"], ["kraken", "stale"]], "the latest prices from Coinbase and Kraken are out of date"],
    ["a venue that has not yet quoted", [["massive", "never_quoted"]], "the server is waiting for the first price from Massive"],
    ["two venues that have not yet quoted", [["coinbase", "never_quoted"], ["kraken", "never_quoted"]], "the server is waiting for the first prices from Coinbase and Kraken"],
    ["a venue lost and another delayed", [["kraken", "delayed"], ["coinbase", "down"]], "the server has lost its connection to Coinbase and the prices received from Kraken are delayed"],
    ["a venue this app has no name for", [["newvenue", "down"]], "the server has lost its connection to Newvenue"],
    ["no venue that reports a problem", [["coinbase", "counts"], ["kraken", "not_expected"]], "the server is not currently receiving enough up-to-date prices"],
  ] as [string, [string, SourceState][], string][])("names %s", (_, sources, why) => {
    expect(unpricedWhy(pricing(sources, "too_few_sources"))).toBe(why);
  });

  it("names the prices that disagree, or says they do", () => {
    expect(unpricedWhy(pricing([["coinbase", "diverging"], ["kraken", "diverging"]], "diverging"))).toBe("the prices received from Coinbase and Kraken currently disagree");
    expect(unpricedWhy(pricing([], "diverging"))).toBe("the prices received from different price feeds currently disagree");
  });

  it("says when a futures price is out of range", () => {
    expect(unpricedWhy(pricing([["cme", "counts"]], "out_of_range"))).toBe("the underlying futures price is outside its permitted range");
  });

  it("says nothing for a priced market, or a server that does not say", () => {
    expect(unpricedWhy(pricing([["coinbase", "counts"], ["kraken", "delayed"]]))).toBeNull();
    expect(unpricedWhy(undefined)).toBeNull();
  });
});

describe("a refusal for want of a price", () => {
  it("names the same reason as the ticket, where the server says", () => {
    expect(noPriceRefusal(LAGGING)).toBe("No live price is currently available for this market because the prices received from Kraken are delayed.");
    expect(noPriceRefusal(undefined)).toBe("No live price is currently available for this market.");
    expect(noPriceClose("BTC-USD", LAGGING)).toBe("The BTC-USD position was not closed, because no live price is currently available for its market. The prices received from Kraken are delayed.");
    expect(noPriceClose("BTC-USD", undefined)).toBe("The BTC-USD position was not closed, because no live price is currently available for its market.");
  });
});
