/** Tests for the volume tier card on the Funding page, and the figures the account strip takes from the node's read. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixedFromInt } from "@/lib/fixed";
import type { HouseParams } from "@/lib/house";
import type { MarketView, VolumeTierWire } from "@/lib/engine/types";
import type { AccountModel } from "@/lib/models";
import type { ConsoleState } from "@/lib/store/state";
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

/** What a test sets on the store, besides the account and parameters, before the card renders; `marketsOverride` replaces the selected market's bands. */
type Patch = Partial<ConsoleState> & { marketsOverride?: Partial<MarketView> };

function Seed({ patch }: { patch: Patch }) {
  const { store } = useSession();
  const { marketsOverride, ...state } = patch;
  const markets = marketsOverride === undefined ? undefined : store.getSnapshot().markets.map((m) => (m.id === 1 ? { ...m, view: { ...m.view, ...marketsOverride } } : m));
  store.patch({ selected: 1, ...state, ...(markets === undefined ? {} : { markets }) });
  return null;
}

const renderWith = (patch: Patch) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { patch }), createElement(VolumeTierCard)));

const render = (account: AccountModel | null, params: HouseParams | null, ...parts: Parameters<typeof createElement>[0][]) =>
  renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { patch: { account, houseParams: params, pricingCurrent: params !== null } }), ...parts.map((part) => createElement(part))));

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

  it("names a toxicity tier of zero as none, and an add-on in bps", () => {
    expect(render({ ...ACCOUNT, toxicity: { tier: 0, addOnBps: 0 } }, PARAMS, VolumeTierCard)).toMatch(/Toxicity add-on<\/dt><dd[^>]*>None</);
    expect(render(ACCOUNT, PARAMS, VolumeTierCard)).toContain("+2 bps on every price");
  });

  it("shows what each tier takes off the profit fee and financing and adds to emissions from V68, and no rows from a node that predates it", () => {
    const benefits: VolumeTierWire[] = TABLE.map((tier, at) => (at === 1 ? { ...tier, fee_discount_bps: 1_000, financing_discount_bps: 500, emissions_boost_bps: 2_500 } : tier));
    const served = decodeVolume({ tier: 0, matured: "0", pending: "0", progress: [{ capped: "0", days: 0 }, { capped: "0", days: 0 }], best_price_bounds: {}, fee_discount_bps: 0, financing_discount_bps: 0, emissions_boost_bps: 0 });
    const html = render({ ...ACCOUNT, ...(served === null ? {} : { volume: served }) }, { ...PARAMS, volumeTiers: benefits }, VolumeTierCard);
    expect(html).toMatch(/Profit fee discount<\/th><td[^>]*>None<\/td><td[^>]*>10%</);
    expect(html).toMatch(/Financing discount<\/th><td[^>]*>None<\/td><td[^>]*>5%</);
    expect(html).toMatch(/Emissions boost<\/th><td[^>]*>1x<\/td><td[^>]*>1.25x</);
    expect(render(ACCOUNT, PARAMS, VolumeTierCard)).not.toContain("Profit fee discount");
  });

  it("shows the account's figures without terms until the parameters are read", () => {
    const html = render(ACCOUNT, null, VolumeTierCard);
    expect(html).toContain("Tier 0");
    expect(html).toContain("parameters are read");
    // The table keeps its rows, with dashes, so the page below does not move when the terms arrive.
    expect(html).toContain("What each tier brings");
    expect(html).toContain("Best-price size");
    expect(html).not.toContain("Up to $500,000");
  });

  it("holds its frame while the page load's wallet is still connecting, before any wallet is known", () => {
    const connecting = renderWith({ account: null, houseParams: PARAMS, pricingCurrent: true, accountRead: false, wallet: null, walletDecided: false });
    expect(connecting).toContain("Volume tier");
    expect(connecting).toContain("Best-price size");
    // Once the load has settled with no wallet there is nothing to hold a place for.
    expect(renderWith({ account: null, houseParams: PARAMS, pricingCurrent: true, accountRead: false, wallet: null, walletDecided: true })).not.toContain("Volume tier");
  });

  it("holds its frame with dashes while a connected wallet's account is read, and shows nothing once it is read without volume", () => {
    const pending = renderWith({ account: null, houseParams: PARAMS, pricingCurrent: true, accountRead: false, wallet: { address: "0xabc", label: "w" } });
    expect(pending).toContain("Volume tier");
    expect(pending).toContain("Best-price size");
    expect(pending).not.toContain("Tier 0");
    // The sentence and the toxicity cell the read brings keep their places, unseen or as dashes.
    expect(pending).toMatch(/aria-hidden="true" class="invisible[^"]*">Tier 1 needs/);
    expect(pending).toMatch(/Toxicity add-on<\/dt><dd[^>]*>—</);
    const unsupported = renderWith({ account: { ...ACCOUNT, volume: undefined }, houseParams: PARAMS, pricingCurrent: true, accountRead: true, wallet: { address: "0xabc", label: "w" } });
    expect(unsupported).not.toContain("Volume tier");
  });

  it("states a leverage held down by a weekend margin that applies now, in the table", () => {
    const WTI = { margin_tiers: [{ up_to: "2000000", bps: 100 }, { up_to: null, bps: 500 }], weekend_margin: { weekend_margin_bps: 750, from: 0, close: 7_200_000, reopen: 1e13 } };
    const html = renderWith({ account: ACCOUNT, houseParams: PARAMS, pricingCurrent: true, now: 1_000, marketsOverride: WTI });
    // Tier 0's 5% floor allows 20x, tier 1's 2% allows 50x; a 7.5% weekend margin holds both to 13x.
    expect(html.match(/Up to 13x/g)).toHaveLength(2);
    expect(html).not.toContain("Up to 20x");
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
    expect(html).toContain("Initial requirement");
    expect(html).toContain("$2,500.00");
    // Free is equity above that requirement; withdrawable is the node's own figure.
    expect(html).toContain("$7,500.00");
    expect(html).toContain("$7,400.00");
  });

  it("keeps its five figures before V64", () => {
    const html = render({ ...ACCOUNT, requirements: undefined }, PARAMS, AccountSummary);
    expect(html).not.toContain("Initial requirement");
    expect(html).toContain("$9,000.00");
  });
});
