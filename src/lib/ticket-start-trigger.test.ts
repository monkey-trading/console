/** Tests for a resting order's starting size: its minimum is valued at the trigger price, not the mark. */

import { describe, expect, it } from "vitest";

import type { MarketModel } from "./models";
import { previewTicket, sizeShown, startingSize } from "./ticket";
import { account, btcAt, NAV, q, quotedIn } from "./ticket-fixtures";

const withMinimum = (market: MarketModel, minimum: string): MarketModel => ({ ...market, view: { ...market.view, min_order_notional: minimum } });

/** Whether the ticket's own check, for a resting order at `trigger`, refuses `size` on the minimum. */
function belowMinimum(market: MarketModel, size: string, trigger: string): boolean {
  const { problems } = previewTicket({ market, side: "buy", qty: q(size), slippageBps: 10, resting: true, triggerPrice: q(trigger), account: account(1_000_000), houseNav: NAV });
  return problems.some((p) => p.startsWith("Minimum order"));
}

describe("a resting order's starting size", () => {
  it("values the minimum at a trigger below the mark, so the ticket's own check passes", async () => {
    const market = withMinimum(await btcAt(61_291), "100");
    expect(startingSize(market, q("50000"))).toBe("0.002");
    expect(belowMinimum(market, "0.002", "50000")).toBe(false);
    expect(belowMinimum(market, "0.001999", "50000")).toBe(true);
    // The size worked out at the mark is the one that used to fail.
    expect(belowMinimum(market, startingSize(market) ?? "", "50000")).toBe(true);
  });

  it("values the minimum at a trigger above the mark", async () => {
    const market = withMinimum(await btcAt(50_000), "100");
    expect(startingSize(market, q("100000"))).toBe("0.001");
    expect(belowMinimum(market, "0.001", "100000")).toBe(false);
  });

  it("converts through the FX mark, as the check does", async () => {
    const eur = await quotedIn("eur", 2, "1.05");
    const size = startingSize(eur, q("1"));
    expect(belowMinimum(eur, size ?? "", "1")).toBe(false);
    expect(size).not.toBe(startingSize(eur));
  });

  it("uses the mark with no trigger, or one not above zero", async () => {
    const market = withMinimum(await btcAt(50_000), "100");
    const atMark = startingSize(market);
    expect(atMark).toBe("0.002");
    expect(startingSize(market, null)).toBe(atMark);
    expect(startingSize(market, 0n)).toBe(atMark);
    expect(startingSize(market, -q("5"))).toBe(atMark);
  });

  it("stays null with no mark, even with a trigger", async () => {
    expect(startingSize({ ...(await btcAt(50_000)), mark: null }, q("40000"))).toBeNull();
  });

  it("never replaces a size the trader typed or cleared", async () => {
    const market = withMinimum(await btcAt(50_000), "100");
    expect(sizeShown("0.5", market, q("40000"))).toBe("0.5");
    expect(sizeShown("", market, q("40000"))).toBe("");
    expect(sizeShown(null, market, q("40000"))).toBe("0.0025");
  });
});
