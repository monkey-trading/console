/** Tests for the size a new ticket shows when the trader keeps the last size placed in the market. */

import { describe, expect, it } from "vitest";

import type { MarketModel } from "./models";
import { sizeShown } from "./ticket";
import { btcAt } from "./ticket-fixtures";

const withMinimum = (market: MarketModel, minimum: string): MarketModel => ({ ...market, view: { ...market.view, min_order_notional: minimum } });

describe("sizeShown with a last size", () => {
  it("shows the last size to a trader who has not touched the field", async () => {
    const market = withMinimum(await btcAt(77_575), "100");
    expect(sizeShown(null, market, null, "0.5")).toBe("0.5");
  });

  it("never replaces what the trader typed, or a field they cleared", async () => {
    const market = withMinimum(await btcAt(77_575), "100");
    expect(sizeShown("2", market, null, "0.5")).toBe("2");
    expect(sizeShown("", market, null, "0.5")).toBe("");
  });

  it("starts at the minimum when the last size is now under it", async () => {
    const market = withMinimum(await btcAt(77_575), "100");
    expect(sizeShown(null, market, null, "0.0001")).toBe("0.00129");
    expect(sizeShown(null, market, null, "0.00129")).toBe("0.00129");
  });

  it("starts at the minimum when the last size is not one the field accepts", async () => {
    const market = withMinimum(await btcAt(77_575), "100");
    for (const last of ["abc", "-1", "0.0000001", ""]) expect(sizeShown(null, market, null, last), last).toBe("0.00129");
  });

  it("shows the last size while the market has no price to start from", async () => {
    const market = { ...withMinimum(await btcAt(77_575), "100"), mark: null };
    expect(sizeShown(null, market, null, "0.5")).toBe("0.5");
    expect(sizeShown(null, market, null, null)).toBe("");
  });
});
