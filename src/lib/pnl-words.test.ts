import { describe, expect, it } from "vitest";

import { describeDetails, describeNoClose, describeNoPrice, type CloseGaps } from "./pnl-words";

const OK: CloseGaps = { symbol: "BTC-USD", open: true, marked: true, converts: true, quoted: true, asked: true, termsCurrent: true, houseNote: null, rateRead: true };

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
  it("gives the profit or loss at the mark, before the spread, and what the fee comes to", () => {
    expect(describeDetails({ atMark: "$20.00", noPrice: null, noClose: null, noFee: false })).toBe("At the mark price, before the spread, the unrealised profit or loss is $20.00.");
    expect(describeDetails({ atMark: "-$20.00", noPrice: null, noClose: null, noFee: true })).toBe("No profit fee applies, because closing the position now would not realise a profit. At the mark price, before the spread, the unrealised profit or loss is -$20.00.");
  });

  it("says why the closing figures are withheld, with the mark's as the only figure there is", () => {
    expect(describeDetails({ atMark: "$20.00", noPrice: null, noClose: "The trading terms have not loaded yet.", noFee: false })).toBe("The profit fee and closing figures are not yet available. At the mark price, before the spread, the unrealised profit or loss is $20.00.");
    expect(describeDetails({ atMark: "$20.00", noPrice: "The market is closed, so no closing price is available.", noClose: "The market is closed, so no closing price is available.", noFee: false })).toBe("The market is closed, so no closing price is available. At the mark price, the unrealised profit or loss is $20.00.");
    expect(describeDetails({ atMark: null, noPrice: "No price is available for this market yet.", noClose: "No price is available for this market yet.", noFee: false })).toBe("No price is available for this market yet.");
  });
});
