/** Tests for the note under the watchlist: the kinds of market it holds, named from the listed markets' asset classes. */

import { describe, expect, it } from "vitest";

import { describeListing } from "./Watchlist";

describe("describeListing", () => {
  it("names each listed asset class once, in a fixed order, whatever order the markets come in", () => {
    expect(describeListing(["commodity", "crypto", "index", "fx", "crypto"])).toBe("This list covers crypto, FX, index and commodity markets.");
    expect(describeListing(["equity", "fx"])).toBe("This list covers FX and share markets.");
  });

  it("names a single class alone, and says nothing for an empty list", () => {
    expect(describeListing(["crypto", "crypto"])).toBe("This list covers crypto markets.");
    expect(describeListing([])).toBeNull();
  });
});
