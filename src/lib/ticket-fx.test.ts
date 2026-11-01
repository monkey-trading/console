/** Tests for the ticket's valuation of a market quoted in another currency, through its FX mark. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { NO_FX_PRICE, previewTicket } from "./ticket";
import { account, btcAt, heldIn, NAV, q, quotedIn } from "./ticket-fixtures";

describe("previewTicket for a market quoted in another currency", () => {
  it("values a market quoted in euros or pounds through its FX mark, rounded down", async () => {
    const base = { side: "buy" as const, slippageBps: 10, account: account(100_000), houseNav: NAV };
    const eur = await quotedIn("eur", 500, "1.1");
    // 0.2 x 500 = 100 EUR = 110 USD, and 0.19 x 500 = 95 EUR = 104.5 USD: both clear $100, where 95 untranslated would not.
    expect(previewTicket({ ...base, market: eur, qty: q("0.19") }).notional).toBe(q("104.5"));
    expect(previewTicket({ ...base, market: eur, qty: q("0.19") }).problems).toEqual([]);
    const short = previewTicket({ ...base, market: eur, qty: q("0.18") });
    expect(short.notional).toBe(q("99"));
    expect(short.problems).toContain("Minimum order is 100 USD.");
    // A euro worth 0.9 dollars makes the same 100 EUR only 90 USD.
    expect(previewTicket({ ...base, market: await quotedIn("eur", 500, "0.9"), qty: q("0.2") }).problems).toContain("Minimum order is 100 USD.");
    expect(previewTicket({ ...base, market: await quotedIn("gbp", 500, "1.25"), qty: q("0.16") }).notional).toBe(fixedFromInt(100));
    // The engine truncates the conversion: 90.909090909 x 1.1 is 99.9999999999 exactly, so $99.999999999, under the minimum, where rounding up would admit it.
    const inexact = previewTicket({ ...base, market: await quotedIn("eur", "90.909090909", "1.1"), qty: q("1") });
    expect(inexact.notional).toBe(q("99.999999999"));
    expect(inexact.problems).toContain("Minimum order is 100 USD.");
    expect(previewTicket({ ...base, market: await quotedIn("eur", "90.909090910", "1.1"), qty: q("1") }).problems).toEqual([]);
  });

  it("values a yen-quoted market by dividing by its FX mark, and the pair's own listing at the price it is valued at", async () => {
    const base = { side: "buy" as const, slippageBps: 10, account: account(100_000), houseNav: NAV };
    // 1 contract at 30,000 yen, with the dollar at 150 yen, is $200.
    const nikkei = await quotedIn("jpy", 30_000, "150");
    expect(previewTicket({ ...base, market: nikkei, qty: q("1") }).notional).toBe(fixedFromInt(200));
    expect(previewTicket({ ...base, market: nikkei, qty: q("0.49") }).problems).toContain("Minimum order is 100 USD.");
    // Dividing truncates too: 149.999999999 / 1.5 is 99.9999999993..., so $99.999999999, under the minimum, where rounding up would admit it.
    const inexact = previewTicket({ ...base, market: await quotedIn("jpy", "149.999999999", "1.5"), qty: q("1") });
    expect(inexact.notional).toBe(q("99.999999999"));
    expect(inexact.problems).toContain("Minimum order is 100 USD.");
    // The dollar against the yen lists itself as its FX market: a contract is a dollar whatever the rate.
    const pair = await quotedIn("jpy", 150, "150", 9);
    expect(previewTicket({ ...base, market: pair, qty: q("100") }).notional).toBe(fixedFromInt(100));
    expect(previewTicket({ ...base, market: pair, qty: q("99.999999") }).problems).toContain("Minimum order is 100 USD.");
    // A resting order on the pair converts at its trigger price, not at the mark.
    const resting = previewTicket({ ...base, market: pair, qty: q("100"), resting: true, triggerPrice: fixedFromInt(200) });
    expect(resting.notional).toBe(fixedFromInt(100));
    expect(resting.problems).toEqual([]);
  });

  it("prices nothing while an FX market has no mark, as the node refuses every fill then, a close included", async () => {
    const base = { slippageBps: 10, houseNav: NAV };
    const eur = await quotedIn("eur", 500, null);
    const open = previewTicket({ ...base, market: eur, side: "buy", qty: q("1"), account: account(100_000) });
    expect(open.problems).toEqual([NO_FX_PRICE]);
    expect(open.notional).toBeNull();
    expect(open.quote).toBeNull();
    const close = previewTicket({ ...base, market: eur, side: "sell", qty: q("1"), account: heldIn(eur, "1") });
    expect(close.problems).toEqual([NO_FX_PRICE]);
    expect(close.quote).toBeNull();
    const missing = { ...eur, view: { ...eur.view } };
    delete missing.view.fx_mark;
    expect(previewTicket({ ...base, market: missing, side: "buy", qty: q("1"), account: account(100_000) }).problems).toEqual([NO_FX_PRICE]);
  });

  it("measures margin, the spread's size tiers and the house's cap in USD for a market quoted in another currency", async () => {
    const base = { side: "buy" as const, slippageBps: 10, account: account(100_000), houseNav: NAV };
    // One contract at 30,000 yen with the dollar at 150 yen is a $200 position, not a 30,000 one.
    const nikkei = await quotedIn("jpy", 30_000, "150");
    const one = previewTicket({ ...base, market: nikkei, qty: q("1") });
    expect(one.markNotional).toBe(fixedFromInt(200));
    expect(one.marginAdded).toBe(fixedFromInt(4)); // the first tier's 2% of $200
    expect(one.marginRateBps).toBe(200);
    expect(one.houseCap).toBe(NAV / 20n);
    // Ten contracts are $2,000: the spread is the one a $2,000 order pays in a dollar market, though they are 300,000 yen, past the first tier's top.
    const sameInUsd = previewTicket({ ...base, market: await btcAt(200), qty: q("10") });
    const ten = previewTicket({ ...base, market: nikkei, qty: q("10") });
    expect(ten.markNotional).toBe(fixedFromInt(2_000));
    expect(ten.spreadBps).toBe(sameInUsd.spreadBps);
    // The spread this fill pays comes off equity in USD: $41 covers the $40 margin of ten contracts plus a spread of well under a dollar, though the spread is dozens of yen.
    expect(previewTicket({ ...base, market: nikkei, qty: q("10"), account: account(41) }).problems).toEqual([]);
    expect(previewTicket({ ...base, market: nikkei, qty: q("10"), account: account(40) }).problems).toContain("Not enough equity for the margin this needs.");
    // A euro market converts by multiplying.
    expect(previewTicket({ ...base, market: await quotedIn("eur", 500, "1.1"), qty: q("2") }).markNotional).toBe(fixedFromInt(1_100));
  });

});
