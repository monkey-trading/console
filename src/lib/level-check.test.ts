/** Tests for what the deal ticket and the position editor check of a take profit and stop loss before anything is signed. */

import { describe, expect, it } from "vitest";

import { fixedFromInt, type Fixed } from "./fixed";
import { checkEditorLevels, checkTicketLevels, EMPTY_FIELDS, type EditorLevelsInput, type TicketLevelsInput } from "./level-check";
import { NO_LEVELS } from "./levels";
import { btcAt, q } from "./ticket-fixtures";
import type { TicketLimits } from "./tier-view";

const market = await btcAt(100_000);
const usd = (x: Fixed) => x;
/** Room for one more working order slot, or none. */
const limits = (resting: number): TicketLimits => ({ tier: 0, bestPriceBound: null, leverage: null, weekendSets: false, orderLimit: 25, resting, levelSlots: 0 });

/** A market buy of 1 BTC with nothing held; the long would close at 99,980. */
const ticket = (patch: Partial<TicketLevelsInput>): TicketLevelsInput => ({
  market, side: "buy", qty: fixedFromInt(1), resting: false, price: q("100020"), held: 0n, heldLevels: NO_LEVELS, closing: q("99980"), capped: null, unmeasured: null, limits: limits(0), fields: EMPTY_FIELDS, toUsdDown: usd, ...patch,
});

describe("the ticket's levels on a market order", () => {
  it("checks nothing and blocks nothing with both fields empty", () => {
    expect(checkTicketLevels(ticket({}))).toMatchObject({ blocked: false, general: null, problems: { take_profit: null, stop_loss: null }, named: NO_LEVELS });
  });

  it("measures each level from the closing price of the position the order leaves, naming the nearest level accepted", () => {
    // 30 bps of 99,980 is 299.94: a take profit from 100,279.94 and a stop loss to 99,680.06.
    const check = checkTicketLevels(ticket({ fields: { takeProfit: "100200", stopLoss: "99700" } }));
    expect(check?.blocked).toBe(true);
    expect(check?.problems.take_profit).toBe("Take profit too close to the closing price. In this market, a take profit on a long position must be at least 0.3% above the price at which the position would close, which is currently 99,980.00. Set a take profit of 100,279.94 or higher.");
    expect(check?.problems.stop_loss).toBe("Stop loss too close to the closing price. In this market, a stop loss on a long position must be at least 0.3% below the price at which the position would close, which is currently 99,980.00. Set a stop loss of 99,680.06 or lower.");
    expect(checkTicketLevels(ticket({ fields: { takeProfit: "100279.94", stopLoss: "99680.06" } }))).toMatchObject({ blocked: false, named: { takeProfit: q("100279.94"), stopLoss: q("99680.06") } });
  });

  it("measures a take profit from the mark where the closing price may be capped nearer it, and a stop loss still from the closing price", () => {
    // A live node may cap the close nearer the mark than the console's estimate: the mark is the strictest a take profit can be measured from.
    const check = checkTicketLevels(ticket({ capped: fixedFromInt(100_000), fields: { takeProfit: "100250", stopLoss: "99700" } }));
    expect(check?.problems.take_profit).toBe("Take profit too close to the market price. While the closing price is an estimate, a take profit on a long position must be at least 0.3% above the market price, which is currently 100,000.00. Set a take profit of 100,300.00 or higher.");
    expect(check?.problems.stop_loss).toMatch(/^Stop loss too close to the closing price\. In this market, .* which is currently 99,980\.00\./);
    // 100,290 passes against the closing price of 99,980 but not against the mark.
    expect(checkTicketLevels(ticket({ fields: { takeProfit: "100290", stopLoss: "" } }))?.blocked).toBe(false);
    expect(checkTicketLevels(ticket({ capped: fixedFromInt(100_000), fields: { takeProfit: "100290", stopLoss: "" } }))?.blocked).toBe(true);
  });

  it("says a level on the wrong side is on the wrong side", () => {
    const check = checkTicketLevels(ticket({ side: "sell", price: q("99980"), closing: q("100020"), fields: { takeProfit: "", stopLoss: "99000" } }));
    expect(check?.problems.stop_loss).toBe("Stop loss below the closing price. In this market, a stop loss on a short position must be above the price at which the position would close, which is currently 100,020.00, by at least 0.3%. Set a stop loss of 100,320.06 or higher.");
  });

  it("estimates each level's result for the order's size from the price it is sent at, before the fee", () => {
    const check = checkTicketLevels(ticket({ fields: { takeProfit: "101000", stopLoss: "99000" } }));
    expect(check?.estimates).toEqual({ take_profit: q("980"), stop_loss: q("-1020") });
  });

  it("stops levels on an order that only reduces the position, as it leaves nothing for them to protect", () => {
    const check = checkTicketLevels(ticket({ side: "sell", held: fixedFromInt(2), fields: { takeProfit: "", stopLoss: "99000" } }));
    expect(check).toMatchObject({ blocked: true, general: expect.stringContaining("It only reduces your position") });
    expect(checkTicketLevels(ticket({ side: "sell", held: fixedFromInt(1), fields: { takeProfit: "", stopLoss: "99000" } }))?.blocked).toBe(true);
  });

  it("on an add, measures only a level it moves from the position's own, and needs no new slot", () => {
    const heldLevels = { takeProfit: q("100100"), stopLoss: q("99000") };
    // The held take profit is now within the distance, but naming it unchanged does not measure it again.
    expect(checkTicketLevels(ticket({ held: fixedFromInt(1), heldLevels, limits: limits(25), fields: { takeProfit: "100100", stopLoss: "99500" } }))?.blocked).toBe(false);
  });

  it("on a reversal, measures every level against the new position and estimates for the part the order opens", () => {
    const check = checkTicketLevels(ticket({ held: -fixedFromInt(3), qty: fixedFromInt(4), heldLevels: { takeProfit: q("90000"), stopLoss: null }, fields: { takeProfit: "100100", stopLoss: "" } }));
    expect(check?.problems.take_profit).toContain("Take profit too close");
    expect(check?.estimates.take_profit).toBe(q("80"));
  });

  it("stops a first pair of levels past the tier's working order limit, but not levels the position already holds", () => {
    const fields = { takeProfit: "", stopLoss: "99000" };
    expect(checkTicketLevels(ticket({ limits: limits(25), fields }))?.general).toBe("Working order limit reached. Volume tier 0 allows up to 25 working orders at a time, and the take profit and stop loss on a position together count as one. Cancel a working order, or remove the levels from another position, to set levels here.");
    expect(checkTicketLevels(ticket({ limits: limits(24), fields }))?.general).toBeNull();
    expect(checkTicketLevels(ticket({ held: fixedFromInt(1), heldLevels: { takeProfit: null, stopLoss: q("98000") }, limits: limits(25), fields }))?.general).toBeNull();
  });

  it("stops a new or moved level while the closing price cannot be worked out, saying why, but not a level the position already holds", () => {
    const why = "The take profit and stop loss cannot be checked at the moment. The trading terms have changed. The new terms are loading.";
    const unpriced = { closing: null, unmeasured: why };
    expect(checkTicketLevels(ticket({ ...unpriced, fields: { takeProfit: "", stopLoss: "99000" } }))).toMatchObject({ blocked: true, general: why });
    expect(checkTicketLevels(ticket({ ...unpriced, fields: EMPTY_FIELDS }))).toMatchObject({ blocked: false, general: null });
    // An add naming the stop loss the position holds measures nothing, so nothing waits for the closing price.
    const heldLevels = { takeProfit: null, stopLoss: q("99000") };
    expect(checkTicketLevels(ticket({ ...unpriced, held: fixedFromInt(1), heldLevels, fields: { takeProfit: "", stopLoss: "99000" } }))).toMatchObject({ blocked: false, general: null });
  });

  it("says what the levels do to the position held, by what the order does to it", () => {
    const fields = { takeProfit: "", stopLoss: "" };
    expect(checkTicketLevels(ticket({ fields }))?.note).toBeNull();
    expect(checkTicketLevels(ticket({ held: fixedFromInt(1), fields }))?.note).toMatch(/^This order adds to your position\. Each level entered here replaces/);
    expect(checkTicketLevels(ticket({ held: -q("0.5"), fields }))?.note).toMatch(/^This order reverses your position, so the position's current take profit and stop loss are removed/);
    expect(checkTicketLevels(ticket({ resting: true, price: fixedFromInt(95_000), held: fixedFromInt(1), fields }))?.note).toMatch(/^The levels entered here apply only once the order is executed\./);
    expect(checkTicketLevels(ticket({ resting: true, price: fixedFromInt(95_000), held: -fixedFromInt(2), fields }))?.note).toMatch(/^The levels entered here are attached only if this order, when it is executed, leaves you a position in its own direction\./);
  });

  it("says nothing of the order's shape while the size is empty, whatever is held", () => {
    for (const held of [0n, fixedFromInt(1), -fixedFromInt(1)]) {
      expect(checkTicketLevels(ticket({ qty: 0n, held, fields: { takeProfit: "101000", stopLoss: "" } }))).toMatchObject({ general: null, note: null, blocked: false });
    }
  });

  it("shows no fields in a market that takes no levels", async () => {
    const old = { ...market, view: { ...market.view, min_level_distance_bps: undefined } };
    expect(checkTicketLevels(ticket({ market: old, fields: { takeProfit: "1", stopLoss: "" } }))).toBeNull();
  });
});

describe("the ticket's levels on a working order", () => {
  it("measures every level from the order's trigger price, as a long for a buy", () => {
    const check = checkTicketLevels(ticket({ resting: true, price: fixedFromInt(95_000), closing: null, fields: { takeProfit: "95100", stopLoss: "" } }));
    expect(check?.problems.take_profit).toBe("Take profit too close to the trigger price. In this market, a take profit on a long position must be at least 0.3% above the order's trigger price of 95,000.00. Set a take profit of 95,285.00 or higher.");
    expect(check?.general).toBeNull();
  });
});

describe("the position editor's levels", () => {
  const editor = (patch: Partial<EditorLevelsInput>): EditorLevelsInput => ({
    market, qty: fixedFromInt(1), entry: fixedFromInt(99_000), held: { takeProfit: q("101000"), stopLoss: q("98000") }, closing: q("99980"), noClosing: "No closing price.", capped: null, limits: limits(25), fields: { takeProfit: "101000", stopLoss: "98000" }, toUsdDown: usd, ...patch,
  });

  it("offers no save until the fields change the position's levels", () => {
    expect(checkEditorLevels(editor({}))).toMatchObject({ changed: false, blocked: false });
    expect(checkEditorLevels(editor({ fields: { takeProfit: "101000", stopLoss: "98500" } }))).toMatchObject({ changed: true, blocked: false });
  });

  it("removes a level whose field is emptied, and both with both emptied, checking nothing", () => {
    expect(checkEditorLevels(editor({ fields: EMPTY_FIELDS, closing: null }))).toMatchObject({ changed: true, blocked: false, named: NO_LEVELS });
  });

  it("measures only a moved level from the position's closing price", () => {
    const check = checkEditorLevels(editor({ held: { takeProfit: q("100100"), stopLoss: q("98000") }, fields: { takeProfit: "100100", stopLoss: "99900" } }));
    expect([check.problems.take_profit, check.problems.stop_loss?.slice(0, 33)]).toEqual([null, "Stop loss too close to the closin"]);
  });

  it("says why a moved level cannot be checked while the position has no closing price", () => {
    expect(checkEditorLevels(editor({ closing: null, fields: { takeProfit: "102000", stopLoss: "98000" } }))).toMatchObject({ blocked: true, general: "No closing price." });
  });

  it("stops a first pair on a position with none past the working order limit", () => {
    expect(checkEditorLevels(editor({ held: NO_LEVELS, fields: { takeProfit: "102000", stopLoss: "" } })).general).toContain("Working order limit reached.");
    expect(checkEditorLevels(editor({ held: NO_LEVELS, limits: limits(24), fields: { takeProfit: "102000", stopLoss: "" } })).blocked).toBe(false);
  });

  it("estimates each level's result for the whole position from its entry", () => {
    expect(checkEditorLevels(editor({})).estimates).toEqual({ take_profit: fixedFromInt(2_000), stop_loss: fixedFromInt(-1_000) });
  });

  it("refuses a field it cannot read, and does not count it as a change", () => {
    expect(checkEditorLevels(editor({ fields: { takeProfit: "1o1000", stopLoss: "98000" } }))).toMatchObject({ changed: false, blocked: true, problems: { take_profit: "Enter the take profit in digits, such as 61250.50." } });
  });
});
