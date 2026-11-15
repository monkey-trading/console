/** Tests for the volume tier card on the Funding page, and the figures the account strip takes from the node's read. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixedFromInt } from "@/lib/fixed";
import type { HouseParams } from "@/lib/house";
import type { AccountModel } from "@/lib/models";
import { decodeVolume } from "@/lib/volume-tier";

import { AccountSummary } from "./AccountSummary";
import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { VolumeTierCard } from "./VolumeTierCard";

const TABLE = [
  { threshold: "0", day_divisor: 1, best_price_share_bps: 2500, margin_floor_bps: 500, max_resting_orders: 25, requests_per_second: 2 },
  { threshold: "1000000", day_divisor: 2, best_price_share_bps: 5000, margin_floor_bps: 200, max_resting_orders: 50, requests_per_second: 5 },
];
const PARAMS: HouseParams = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [], volumeTiers: TABLE, seq: 1 };
const volume = decodeVolume({
  tier: 0, matured: "400000", pending: "2500", progress: [{ capped: "400000", days: 1 }, { capped: "300000", days: 0 }], best_price_bounds: { "1": "500000" }, max_resting_orders: 25, requests_per_second: 2,
});
const ACCOUNT: AccountModel = {
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: fixedFromInt(1_000), positions: [], orders: [],
  requirements: { initialMargin: fixedFromInt(2_500), maintenanceMargin: fixedFromInt(500), withdrawable: fixedFromInt(7_400), maxLeverage: new Map([[1, fixedFromInt(20)]]) },
  ...(volume === null ? {} : { volume }), toxicity: { tier: 1, addOnBps: 2 },
};

function Seed({ account, params }: { account: AccountModel | null; params: HouseParams | null }) {
  const { store } = useSession();
  store.patch({ account, houseParams: params, pricingCurrent: params !== null, selected: 1 });
  return null;
}

const render = (account: AccountModel | null, params: HouseParams | null, ...parts: Parameters<typeof createElement>[0][]) =>
  renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { account, params }), ...parts.map((part) => createElement(part))));

describe("VolumeTierCard", () => {
  it("shows the tier, counted and pending volume, the step to the next tier and what each tier brings in the selected market", () => {
    const html = render(ACCOUNT, PARAMS, VolumeTierCard);
    expect(html).toContain("Tier 0");
    expect(html).toContain("$400,000.00");
    expect(html).toContain("$2,500.00");
    expect(html).toContain("Tier 1 needs $700,000 more counted volume");
    expect(html).toContain("What each tier brings in BTC-USD");
    expect(html).toContain("Up to $500,000");
    expect(html).toContain("Up to $1,000,000");
    expect(html).toContain("Up to 20x");
    expect(html).toContain("Up to 50x");
    expect(html).toContain("+2 bps on every price");
  });

  it("shows the account's figures without terms until the parameters are read", () => {
    const html = render(ACCOUNT, null, VolumeTierCard);
    expect(html).toContain("Tier 0");
    expect(html).toContain("parameters are read");
    expect(html).not.toContain("What each tier brings");
  });

  it("says so at the top tier, and shows nothing for a node without volume tiers or no account", () => {
    const top = decodeVolume({ tier: 1, matured: "2000000", pending: "0", progress: [{ capped: "0", days: 0 }, { capped: "1000000", days: 2 }], best_price_bounds: {} });
    expect(render({ ...ACCOUNT, ...(top === null ? {} : { volume: top }) }, PARAMS, VolumeTierCard)).toContain("This is the highest tier.");
    expect(render({ ...ACCOUNT, volume: undefined }, PARAMS, VolumeTierCard)).not.toContain("Volume tier");
    expect(render(null, PARAMS, VolumeTierCard)).not.toContain("Volume tier");
  });
});

describe("AccountSummary", () => {
  it("shows what the node's read says is needed to open and may be withdrawn, from V64", () => {
    const html = render(ACCOUNT, PARAMS, AccountSummary);
    expect(html).toContain("Needed to open");
    expect(html).toContain("$2,500.00");
    // Free is equity above that requirement; withdrawable is the node's own figure.
    expect(html).toContain("$7,500.00");
    expect(html).toContain("$7,400.00");
  });

  it("keeps its five figures before V64", () => {
    const html = render({ ...ACCOUNT, requirements: undefined }, PARAMS, AccountSummary);
    expect(html).not.toContain("Needed to open");
    expect(html).toContain("$9,000.00");
  });
});
