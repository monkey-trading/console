/** Tests for what the Positions table says a close pays: the fee beside its help, both from the account's discounted base (V68). */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixedFromInt } from "@/lib/fixed";
import { LAUNCH_CURVE } from "@/lib/holding-fee";
import type { HouseParams } from "@/lib/house";
import type { AccountModel } from "@/lib/models";
import { decodeVolume } from "@/lib/volume-tier";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { PositionsView } from "./PositionsView";

const PARAMS: HouseParams = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [...LAUNCH_CURVE], seq: 1 };
const volume = (feeDiscountBps: number) => decodeVolume({ tier: 2, matured: "0", pending: "0", progress: [], best_price_bounds: {}, fee_discount_bps: feeDiscountBps });
const account = (discount: number): AccountModel => {
  const v = volume(discount);
  return {
    balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: 0n, orders: [], ...(v === null ? {} : { volume: v }),
    // Opened long enough ago that the curve has run, so a close pays the base.
    positions: [{ market: 1, qty: fixedFromInt(1), entry: fixedFromInt(60_000), closeout: null, closeFee: { openedAt: 0, feeBps: 1_000, fallsAt: null } }],
  };
};

function Seed({ discount }: { discount: number }) {
  const { store } = useSession();
  store.patch({ account: account(discount), houseParams: PARAMS, pricingCurrent: true, now: 2_000_000, selected: 1 });
  return null;
}

const render = (discount: number) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { discount }), createElement(PositionsView)));

describe("the Positions table's profit fee", () => {
  it("shows a tier 2 account's discounted base in the cell and in the help beside it, never the house's", () => {
    const html = render(1_000);
    expect(html).toContain("9.00%");
    expect(html).toContain("falling with the hold to 9.00% from");
    expect(html).not.toContain("falling with the hold to 10.00%");
  });

  it("states the house's base for an account with no discount", () => {
    const html = render(0);
    expect(html).toContain("falling with the hold to 10.00% from");
  });
});
