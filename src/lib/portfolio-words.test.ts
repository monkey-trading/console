/** Tests for what the console says about portfolio margin. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { describeLoneClose, describeOffsetSummary, describeOrderMargin, describeUnquoted, describeUntradable, formatNetExposure, hedgeTitle, listSymbols } from "./portfolio-words";

describe("portfolio margin's words", () => {
  it("lists a hedge's markets as a sentence names them", () => {
    expect([listSymbols(["BTC-USD"]), listSymbols(["BTC-USD", "ETH-USD"]), listSymbols(["US500", "US100", "US30"])]).toEqual(["BTC-USD", "BTC-USD and ETH-USD", "US500, US100 and US30"]);
    expect(hedgeTitle(["XAU-USD", "XAG-USD"])).toBe("Hedge: XAU-USD and XAG-USD");
  });

  it("states a net exposure's size and side, or none when the sides match", () => {
    expect([formatNetExposure(fixedFromInt(70_000)), formatNetExposure(fixedFromInt(-56_000)), formatNetExposure(0n)]).toEqual(["$70,000.00 long", "$56,000.00 short", "None"]);
  });

  it("states the requirement before and after the offset, and the close-out level", () => {
    const portfolio = { margin: fixedFromInt(20_010), initialMargin: fixedFromInt(33_450), maintenanceMargin: fixedFromInt(10_005), groups: [] };
    expect(describeOffsetSummary(fixedFromInt(24_000), portfolio)).toBe("Your hedged positions reduce your margin from $24,000.00 to $20,010.00. Your account will be closed out if its equity falls below $10,005.00.");
  });

  it("names the positions a hedge cannot trade, one, several or all of them", () => {
    expect(describeUntradable(["ETH-USD"], 2)).toBe("ETH-USD cannot be traded at present, so Close hedge leaves it open. Until it can be traded again, this hedge does not reduce the margin required for new orders or withdrawals.");
    expect(describeUntradable(["US100", "US30"], 3)).toBe("US100 and US30 cannot be traded at present, so Close hedge leaves them open. Until they can be traded again, this hedge does not reduce the margin required for new orders or withdrawals.");
    expect(describeUntradable(["XAU-USD", "XAG-USD"], 2)).toBe("None of the positions in this hedge can be traded at present. Until they can, this hedge does not reduce the margin required for new orders or withdrawals.");
  });

  it("names the positions of a hedge with no closing price, which Close hedge waits for", () => {
    expect(describeUnquoted(["ETH-USD"])).toBe("Close hedge is unavailable because ETH-USD has no closing price yet. Selecting it in the watchlist loads its closing price.");
    expect(describeUnquoted(["US100", "US30"])).toBe("Close hedge is unavailable because US100 and US30 have no closing price yet. Selecting them in the watchlist loads their closing price.");
  });

  it("says when an order that reduces a hedge raises the initial margin, and otherwise what it leaves", () => {
    const [ten, twelve, nine] = [fixedFromInt(10_000), fixedFromInt(12_000), fixedFromInt(9_000)];
    expect(describeOrderMargin(ten, twelve, nine, true)).toBe("This order reduces a hedge, so your initial margin would rise from $10,000.00 to $12,000.00, with equity of $9,000.00.");
    expect(describeOrderMargin(twelve, ten, nine, true)).toBe("After this order, your initial margin would be $10,000.00 and your equity $9,000.00.");
    expect(describeOrderMargin(ten, twelve, nine, false)).toBe("After this order, your initial margin would be $12,000.00 and your equity $9,000.00.");
    expect(describeLoneClose("BTC-USD")).toBe("Closing BTC-USD on its own would raise your initial margin above your equity, so the order would be rejected. Close hedge closes all of the hedge's positions together.");
  });
});
