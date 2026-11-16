import { describe, expect, it } from "vitest";

import { describeDetails, describeNoClose, describeNoPrice, describePnl, type CloseGaps } from "./pnl-words";

const OK: CloseGaps = { symbol: "BTC-USD", open: true, marked: true, converts: true, quoted: true, asked: true, termsCurrent: true, houseNote: null, rateRead: true };

describe("describePnl", () => {
  it("keeps the figure at the mark in the explanation of a figure at the closing price", () => {
    expect(describePnl("$20.00", null)).toBe("This uses the price you'd close the whole position at. At the mark price it's $20.00, before the spread.");
    expect(describePnl(null, null)).toBe("This uses the price you'd close the whole position at.");
  });

  it("says why a figure is withheld, with the mark's as the only one there is", () => {
    expect(describePnl("$20.00", "The market is closed, so there's no closing price.")).toBe("The market is closed, so there's no closing price. At the mark price it's $20.00.");
    expect(describePnl(null, "Waiting for a closing price.")).toBe("Waiting for a closing price.");
  });
});

describe("describeNoPrice and describeNoClose", () => {
  it("name the first thing a close lacks, in the order it needs them", () => {
    expect(describeNoPrice({ ...OK, open: false, marked: false })).toBe("The market is closed, so there's no closing price.");
    expect(describeNoPrice({ ...OK, marked: false, quoted: false })).toBe("This market has no price yet.");
    expect(describeNoPrice({ ...OK, converts: false, quoted: false })).toBe("The exchange rate for this market isn't available yet, so it can't be shown in USD.");
    expect(describeNoPrice({ ...OK, quoted: false })).toBe("Waiting for a closing price.");
    expect(describeNoPrice({ ...OK, quoted: false, asked: false })).toBe("Select BTC-USD to see its closing price.");
    expect(describeNoPrice(OK)).toBeNull();
  });

  it("blame a closed market before the house state or the rate, which a mock's price for it would otherwise hide", () => {
    expect(describeNoClose({ ...OK, open: false, termsCurrent: false, houseNote: "The trading terms changed. Loading the new ones.", rateRead: false })).toBe("The market is closed, so there's no closing price.");
    expect(describeNoClose({ ...OK, termsCurrent: false, houseNote: "The trading terms changed. Loading the new ones.", rateRead: false })).toBe("The trading terms changed. Loading the new ones.");
    expect(describeNoClose({ ...OK, termsCurrent: false, rateRead: false })).toBe("The trading terms haven't loaded yet.");
    expect(describeNoClose({ ...OK, rateRead: false })).toBe("The profit fee rate hasn't loaded yet.");
    expect(describeNoClose(OK)).toBeNull();
  });
});

describe("describeDetails", () => {
  it("joins the basis and what the fee and the close come to", () => {
    expect(describeDetails({ pnl: "Basis.", noClose: null, noFee: true })).toBe("Basis. There's no profit fee, because closing now doesn't make a profit.");
    expect(describeDetails({ pnl: "Basis.", noClose: "Why.", noFee: false })).toBe("Basis. The fee and close figures aren't shown yet. Why.");
    expect(describeDetails({ pnl: "Basis.", noClose: null, noFee: false })).toBe("Basis.");
  });
});
