/** Tests for the levels in words: the log's lines for each level event, the engine's refusals, and the fields' estimates. */

import { describe, expect, it } from "vitest";

import type { LevelEvent, LevelsRemovedReason } from "./engine/types";
import { fixedFromInt, formatUsd } from "./fixed";
import { describeEstimate, describeLevelEvent, levelClosedSentence } from "./level-words";
import { describeEvent, describeReject } from "./messages";

const symbolOf = () => "BTC-USD";
const ME = "0xabc";

describe("the log's line for a level event", () => {
  it("names the levels a request or an order set, or that it removed both", () => {
    const set = (levels: { take_profit?: string; stop_loss?: string }): LevelEvent => ({ type: "position_levels_set", account: ME, market: 1, ...levels });
    expect(describeLevelEvent(set({ take_profit: "105000", stop_loss: "95000.5" }), symbolOf)).toBe("BTC-USD position: take profit at 105,000 and stop loss at 95,000.5");
    expect(describeLevelEvent(set({ take_profit: "105000" }), symbolOf)).toBe("BTC-USD position: take profit at 105,000, with no stop loss");
    expect(describeLevelEvent(set({ stop_loss: "95000" }), symbolOf)).toBe("BTC-USD position: stop loss at 95,000, with no take profit");
    expect(describeLevelEvent(set({}), symbolOf)).toBe("Take profit and stop loss removed from the BTC-USD position");
  });

  it("names the level that fired and that it closes the whole position", () => {
    expect(describeEvent({ type: "position_level_triggered", account: ME, market: 1, level: "stop_loss", price: "95000", order_id: 9 }, symbolOf)).toBe("Stop loss at 95,000 reached on BTC-USD, closing the whole position");
  });

  it.each<[LevelsRemovedReason, string]>([
    ["closed", "the position was closed"],
    ["close_all", "Close all closed the position"],
    ["take_profit", "the take profit closed the position"],
    ["stop_loss", "the stop loss closed the position"],
    ["close_out", "the position was closed out"],
    ["weekend_close_out", "the position was closed out before the weekend"],
    ["split", "a share split reduced the position to zero"],
    ["reversed", "the position was reversed"],
    ["not_opened", "the order did not leave a position for them to protect"],
  ])("says the levels were removed because of %s", (reason, because) => {
    const event: LevelEvent = { type: "position_levels_removed", account: ME, market: 1, take_profit: "105000", stop_loss: "95000", reason };
    expect(describeLevelEvent(event, symbolOf)).toBe(`Take profit at 105,000 and stop loss at 95,000 removed from BTC-USD because ${because}`);
  });
});

describe("the engine's refusals of levels", () => {
  it("says a level was too close, the rule, and the closing price it was measured from", () => {
    expect(describeReject({ kind: "level_too_close", level: "100100", min_distance_bps: 30, reference: "99980.5" })).toBe("The level 100,100 is too close to the current price. In this market, a take profit or stop loss must be at least 0.3% beyond the price at which the position would close, which was 99,980.5 when your request was processed. Choose a level further from the current price.");
    expect(describeReject({ kind: "levels_unsupported" })).toBe("This server does not support take-profit and stop-loss levels yet.");
  });

  it("puts each of the engine's reasons for a level it cannot take in plain words", () => {
    const words = (reason: string) => describeReject({ kind: "invalid_order", reason });
    expect(words("no position to set levels on")).toBe("You no longer hold a position in this market, so a take profit or stop loss cannot be set on it.");
    expect(words("a reduce-only order names no levels")).toBe("An order that only reduces a position cannot set a take profit or stop loss.");
    expect(words("level out of range")).toBe("The take profit or stop loss is outside the range of prices the server accepts.");
    expect(words("no price to measure levels from")).toBe("No price is available for this market, so the take profit and stop loss cannot be checked. Please try again once prices are updating.");
    expect(words("the market names no minimum level distance")).toBe("This market does not accept take-profit and stop-loss levels.");
  });
});

describe("the fields' estimates and the account notice", () => {
  it("states a profit or a loss before the profit fee, a stop loss's as not guaranteed", () => {
    expect(describeEstimate("take_profit", fixedFromInt(980), formatUsd)).toBe("Estimated profit $980.00 before the profit fee");
    expect(describeEstimate("stop_loss", fixedFromInt(-1_020), formatUsd)).toBe("Estimated loss $1,020.00 before the profit fee, not guaranteed");
    expect(describeEstimate("stop_loss", fixedFromInt(15), formatUsd)).toBe("Estimated profit $15.00 before the profit fee, not guaranteed");
  });

  it("names the level that closed a position and the price it closed at", () => {
    expect(levelClosedSentence("take_profit", "BTC-USD", "105000", "105010.25")).toBe("Your take profit at 105,000 on BTC-USD was reached, so the entire position was closed at 105,010.25.");
  });
});
