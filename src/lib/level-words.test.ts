/** Tests for the levels in words: the log's lines for each level event, the engine's refusals, and the fields' estimates. */

import { describe, expect, it } from "vitest";

import type { LevelEvent, LevelsRemovedReason } from "./engine/types";
import { fixedFromInt, formatUsd } from "./fixed";
import { describeEstimate, describeLevelEvent, describeNamedLevels, headline, levelClosedSentence, levelsSavedWords } from "./level-words";
import { describeEvent, describeReject } from "./messages";

const symbolOf = () => "BTC-USD";
const ME = "0xabc";

describe("the log's line for a level event", () => {
  it("names the levels a request or an order set, or that it removed both", () => {
    const set = (levels: { take_profit?: string; stop_loss?: string }): LevelEvent => ({ type: "position_levels_set", account: ME, market: 1, ...levels });
    expect(describeLevelEvent(set({ take_profit: "105000", stop_loss: "95000.5" }), symbolOf)).toBe("The take profit on the BTC-USD position was set at 105,000 and the stop loss at 95,000.5");
    expect(describeLevelEvent(set({ take_profit: "105000" }), symbolOf)).toBe("The take profit on the BTC-USD position was set at 105,000, with no stop loss");
    expect(describeLevelEvent(set({ stop_loss: "95000" }), symbolOf)).toBe("The stop loss on the BTC-USD position was set at 95,000, with no take profit");
    expect(describeLevelEvent(set({}), symbolOf)).toBe("The take profit and stop loss were removed from the BTC-USD position");
  });

  it("names the level that fired and that it closes the whole position", () => {
    expect(describeEvent({ type: "position_level_triggered", account: ME, market: 1, level: "stop_loss", price: "95000", order_id: 9 }, symbolOf)).toBe("The stop loss at 95,000 on BTC-USD was reached, and the whole position was closed");
  });

  it.each<[LevelsRemovedReason, string]>([
    ["closed", "because the position was closed"],
    ["close_all", "because Close all closed the position"],
    ["take_profit", "because the take profit closed the position"],
    ["stop_loss", "because the stop loss closed the position"],
    ["close_out", "because the position was closed out"],
    ["weekend_close_out", "because the position was closed out before the weekend"],
    // A split's reason also covers a level it scaled out of range with the position still open, so it names only the split.
    ["split", "because of a share split"],
    ["reversed", "because the position was reversed"],
  ])("says the levels were removed %s", (reason, because) => {
    const event: LevelEvent = { type: "position_levels_removed", account: ME, market: 1, take_profit: "105000", stop_loss: "95000", reason };
    expect(describeLevelEvent(event, symbolOf)).toBe(`The take profit at 105,000 and stop loss at 95,000 on BTC-USD were removed ${because}`);
  });

  it("says a level an order named was not kept when the order left no position for it, in the singular for one level", () => {
    const event: LevelEvent = { type: "position_levels_removed", account: ME, market: 1, stop_loss: "95000", reason: "not_opened" };
    expect(describeLevelEvent(event, symbolOf)).toBe("The stop loss at 95,000 named on the BTC-USD order was removed because the order did not leave a position on its side for the levels to protect");
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

describe("what the editor and the wallet say of levels", () => {
  it("tells a screen reader what the position holds once its levels are saved", () => {
    const levels = (takeProfit: bigint | null, stopLoss: bigint | null) => ({ takeProfit, stopLoss });
    expect(levelsSavedWords("BTC-USD", levels(fixedFromInt(105_000), fixedFromInt(95_000)), 2)).toBe("The take profit on your BTC-USD position is now 105,000.00, and the stop loss is 95,000.00.");
    expect(levelsSavedWords("BTC-USD", levels(fixedFromInt(105_000), null), 2)).toBe("The take profit on your BTC-USD position is now 105,000.00, and it has no stop loss.");
    expect(levelsSavedWords("BTC-USD", levels(null, fixedFromInt(95_000)), 2)).toBe("The stop loss on your BTC-USD position is now 95,000.00, and it has no take profit.");
    expect(levelsSavedWords("BTC-USD", levels(null, null), 2)).toBe("The take profit and stop loss on your BTC-USD position have been removed.");
  });

  it("names the levels for the wallet's prompt at the market's places, and none as null", () => {
    expect(describeNamedLevels({ takeProfit: fixedFromInt(105_000), stopLoss: fixedFromInt(95_000) }, 2)).toBe("a take profit at 105,000.00 and a stop loss at 95,000.00");
    expect(describeNamedLevels({ takeProfit: null, stopLoss: null }, 2)).toBeNull();
  });

  it("reads out a problem's first sentence alone, which names no price that moves", () => {
    expect(headline("Stop loss too close to the closing price. In this market, a stop loss ... 99,980.00. Set a stop loss of 99,680.06 or lower.")).toBe("Stop loss too close to the closing price.");
    expect(headline("Enter a take profit above zero.")).toBe("Enter a take profit above zero.");
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
    // A fill's price to five places, as History shows it; the level as it was set.
    expect(levelClosedSentence("stop_loss", "BTC-USD", "95000.5", "94980.692185121")).toBe("Your stop loss at 95,000.5 on BTC-USD was reached, so the entire position was closed at 94,980.69218.");
  });
});
