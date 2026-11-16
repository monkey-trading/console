import { describe, expect, it } from "vitest";

import { describeDetails, describeNoClose, describeNoPrice, describePnl, type CloseGaps } from "./pnl-words";

const OK: CloseGaps = { symbol: "BTC-USD", open: true, marked: true, converts: true, quoted: true, asked: true, termsCurrent: true, houseNote: null, rateRead: true };

describe("describePnl", () => {
  it("keeps the figure at the mark in the explanation of a figure at the closing price", () => {
    expect(describePnl("$20.00", null)).toBe("This figure is calculated at the price at which the entire position would close. At the mark price, before the spread, the unrealised profit or loss is $20.00.");
    expect(describePnl(null, null)).toBe("This figure is calculated at the price at which the entire position would close.");
  });

  it("says why a figure is withheld, with the mark's as the only one there is", () => {
    expect(describePnl("$20.00", "The market is closed, so no closing price is available.")).toBe("The market is closed, so no closing price is available. At the mark price, the unrealised profit or loss is $20.00.");
    expect(describePnl(null, "The closing price for this position is still loading.")).toBe("The closing price for this position is still loading.");
  });
});

describe("describeNoPrice and describeNoClose", () => {
  it("name the first thing a close lacks, in the order it needs them", () => {
    expect(describeNoPrice({ ...OK, open: false, marked: false })).toBe("The market is closed, so no closing price is available.");
    expect(describeNoPrice({ ...OK, marked: false, quoted: false })).toBe("No price is available for this market yet.");
    expect(describeNoPrice({ ...OK, converts: false, quoted: false })).toBe("The exchange rate for this market's quote currency is not yet available, so the profit or loss cannot be shown in USD.");
    expect(describeNoPrice({ ...OK, quoted: false })).toBe("The closing price for this position is still loading.");
    expect(describeNoPrice({ ...OK, quoted: false, asked: false })).toBe("Select BTC-USD in the watchlist to load its closing price.");
    expect(describeNoPrice(OK)).toBeNull();
  });

  it("blame a closed market before the house state or the rate, which a mock's price for it would otherwise hide", () => {
    expect(describeNoClose({ ...OK, open: false, termsCurrent: false, houseNote: "The trading terms have changed. The new terms are loading.", rateRead: false })).toBe("The market is closed, so no closing price is available.");
    expect(describeNoClose({ ...OK, termsCurrent: false, houseNote: "The trading terms have changed. The new terms are loading.", rateRead: false })).toBe("The trading terms have changed. The new terms are loading.");
    expect(describeNoClose({ ...OK, termsCurrent: false, rateRead: false })).toBe("The trading terms have not loaded yet.");
    expect(describeNoClose({ ...OK, rateRead: false })).toBe("The profit fee rate has not loaded yet.");
    expect(describeNoClose(OK)).toBeNull();
  });
});

describe("describeDetails", () => {
  it("joins the basis and what the fee and the close come to", () => {
    expect(describeDetails({ pnl: "Basis.", noClose: null, noFee: true })).toBe("Basis. No profit fee applies, because closing the position now would not realise a profit.");
    expect(describeDetails({ pnl: "Basis.", noClose: "Why.", noFee: false })).toBe("Basis. The profit fee and closing figures are not yet available. Why.");
    expect(describeDetails({ pnl: "Basis.", noClose: null, noFee: false })).toBe("Basis.");
  });
});
