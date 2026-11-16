import { describe, expect, it } from "vitest";

import { describeDetails, describeNoClose, describeNoPrice, describePnl, type CloseGaps } from "./pnl-words";

const OK: CloseGaps = { symbol: "BTC-USD", open: true, marked: true, converts: true, quoted: true, asked: true, termsCurrent: true, houseNote: null, rateRead: true };

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

describe("describeNoPrice and describeNoClose", () => {
  it("name the first thing a close lacks, in the order it needs them", () => {
    expect(describeNoPrice({ ...OK, open: false, marked: false })).toBe("The market is closed, so it has no closing price.");
    expect(describeNoPrice({ ...OK, marked: false, quoted: false })).toBe("The market has no price yet.");
    expect(describeNoPrice({ ...OK, converts: false, quoted: false })).toBe("The market's FX price has not been read yet, so it cannot be converted to USD.");
    expect(describeNoPrice({ ...OK, quoted: false })).toBe("No closing price has reached the console yet.");
    expect(describeNoPrice({ ...OK, quoted: false, asked: false })).toBe("Select BTC-USD to get its closing price.");
    expect(describeNoPrice(OK)).toBeNull();
  });

  it("blame a closed market before the house state or the rate, which a mock's price for it would otherwise hide", () => {
    expect(describeNoClose({ ...OK, open: false, termsCurrent: false, houseNote: "Reading the node's parameters again after a change.", rateRead: false })).toBe("The market is closed, so it has no closing price.");
    expect(describeNoClose({ ...OK, termsCurrent: false, houseNote: "Reading the node's parameters again after a change.", rateRead: false })).toBe("Reading the node's parameters again after a change.");
    expect(describeNoClose({ ...OK, termsCurrent: false, rateRead: false })).toBe("The node's parameters have not been read yet.");
    expect(describeNoClose({ ...OK, rateRead: false })).toBe("The profit fee rate has not been read yet.");
    expect(describeNoClose(OK)).toBeNull();
  });
});

describe("describeDetails", () => {
  it("joins the basis, what the fee and the close come to, and when the rate falls", () => {
    expect(describeDetails({ pnl: "Basis.", noClose: null, noFee: true, next: "Base rate" })).toBe("Basis. No profit fee on this close: it realises a loss or nothing. Profit fee rate: Base rate.");
    expect(describeDetails({ pnl: "Basis.", noClose: "Why.", noFee: false, next: null })).toBe("Basis. The profit fee and what a close keeps are withheld: Why.");
    expect(describeDetails({ pnl: "Basis.", noClose: null, noFee: false, next: null })).toBe("Basis.");
  });
});
