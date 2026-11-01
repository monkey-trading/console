/** Tests for the size a new ticket starts at: the market's minimum order, on the size field's step. */

import { describe, expect, it } from "vitest";

import type { MarketModel } from "./models";
import { previewTicket, sizeShown, startingSize } from "./ticket";
import { account, btcAt, NAV, q, quotedIn } from "./ticket-fixtures";

const withMinimum = (market: MarketModel, minimum: string): MarketModel => ({ ...market, view: { ...market.view, min_order_notional: minimum } });
const STEP = q("0.000001");

/** Whether the ticket's own check lets `size` through on the minimum. */
function belowMinimum(market: MarketModel, size: string): boolean {
  const qty = q(size);
  const { problems } = previewTicket({ market, side: "buy", qty, slippageBps: 10, account: account(1_000_000), houseNav: NAV });
  return problems.some((p) => p.startsWith("Minimum order"));
}

describe("startingSize", () => {
  it("starts at the smallest step that reaches the spec's minimum, written without trailing zeros", async () => {
    const btc = await btcAt(77_575);
    expect(startingSize(withMinimum(btc, "10"))).toBe("0.000129");
    expect(startingSize(withMinimum(btc, "100"))).toBe("0.00129");
    expect(startingSize(withMinimum(btc, "1000"))).toBe("0.012891");
  });

  it("starts at one step where the spec's minimum is zero", async () => {
    expect(startingSize(withMinimum(await btcAt(77_575), "0"))).toBe("0.000001");
  });

  it("starts at exactly the minimum when a step lands on it, and one step less is below it", async () => {
    const market = withMinimum(await btcAt(100_000), "100");
    expect(startingSize(market)).toBe("0.001");
    expect(belowMinimum(market, "0.001")).toBe(false);
    expect(belowMinimum(market, "0.000999")).toBe(true);
  });

  it("rounds its USD value down as the check does, so a third of a step short stays short", async () => {
    // 1 / 3 = 0.333333…: 0.333333 is worth 0.999999, and the next step 1.000002.
    const market = withMinimum(await btcAt(3), "1");
    expect(startingSize(market)).toBe("0.333334");
    expect(belowMinimum(market, "0.333333")).toBe(true);
    expect(belowMinimum(market, "0.333334")).toBe(false);
  });

  it("passes the ticket's own minimum check, and one step less fails it, across marks and minimums", async () => {
    for (const mark of ["0.0123", "1.05", "2254", "77575", "123456.789"]) {
      for (const minimum of ["10", "100", "250.5"]) {
        const market = withMinimum(await btcAt(mark), minimum);
        const size = startingSize(market);
        expect(size, `${mark} / ${minimum}`).not.toBeNull();
        expect(belowMinimum(market, size ?? ""), `${mark} / ${minimum} at ${size}`).toBe(false);
        expect(belowMinimum(market, fromFixed(q(size ?? "") - STEP)), `${mark} / ${minimum} one step less`).toBe(true);
      }
    }
  });

  it("converts a market quoted in another currency through its FX mark", async () => {
    const eur = await quotedIn("eur", "1.05", "1.08");
    expect(startingSize(eur)).toBe("88.183422");
    expect(belowMinimum(eur, "88.183422")).toBe(false);
    expect(belowMinimum(eur, "88.183421")).toBe(true);
    const jpy = await quotedIn("jpy", "38000", "150");
    expect(startingSize(jpy)).toBe("0.394737");
    expect(belowMinimum(jpy, "0.394737")).toBe(false);
    expect(belowMinimum(jpy, "0.394736")).toBe(true);
  });

  it("is null while the market has no mark, or no FX price to value it at", async () => {
    expect(startingSize({ ...(await btcAt(77_575)), mark: null })).toBeNull();
    expect(startingSize(await quotedIn("eur", "1.05", null))).toBeNull();
  });

  it("follows the mark, so an untouched size stays the true minimum", async () => {
    const at = async (mark: number) => startingSize(withMinimum(await btcAt(mark), "100"));
    expect(await at(77_575)).toBe("0.00129");
    expect(await at(100_000)).toBe("0.001");
    expect(await at(1_000_000)).toBe("0.0001");
  });
});

/** A fixed quantity as the size field's text. */
function fromFixed(value: bigint): string {
  const digits = value.toString().padStart(10, "0");
  return `${digits.slice(0, -9)}.${digits.slice(-9)}`;
}

describe("sizeShown", () => {
  it("shows the starting size to a trader who has not touched the field, and follows the mark", async () => {
    const before = withMinimum({ ...(await btcAt(77_575)) }, "100");
    expect(sizeShown(null, { ...before, mark: null })).toBe("");
    expect(sizeShown(null, before)).toBe("0.00129");
    expect(sizeShown(null, { ...before, mark: q("100000") })).toBe("0.001");
  });

  it("never replaces what the trader typed when the mark changes", async () => {
    const market = withMinimum(await btcAt(77_575), "100");
    expect(sizeShown("0.5", market)).toBe("0.5");
    expect(sizeShown("0.5", { ...market, mark: q("100000") })).toBe("0.5");
  });

  it("keeps a cleared field empty, with or without a mark", async () => {
    const market = withMinimum(await btcAt(77_575), "100");
    expect(sizeShown("", market)).toBe("");
    expect(sizeShown("", { ...market, mark: q("100000") })).toBe("");
    expect(sizeShown("", { ...market, mark: null })).toBe("");
  });
});
