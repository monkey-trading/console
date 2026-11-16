import { describe, expect, it } from "vitest";

import { describePnl } from "./pnl-words";

describe("describePnl", () => {
  it("keeps the figure at the mark in the explanation of a figure at the closing price", () => {
    expect(describePnl("$20.00", null)).toBe("At the node's closing price for this size. At the mark it is $20.00, before the exit spread.");
    expect(describePnl(null, null)).toBe("At the node's closing price for this size.");
  });

  it("says why a figure is withheld, with the mark's as the only one there is", () => {
    expect(describePnl("$20.00", "The market is closed, so it has no closing price.")).toBe("The market is closed, so it has no closing price. At the mark it is $20.00.");
    expect(describePnl(null, "No closing price has reached the console yet.")).toBe("No closing price has reached the console yet.");
  });
});
