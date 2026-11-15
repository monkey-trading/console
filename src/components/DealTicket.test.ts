/** Tests for what the deal ticket shows of the account's volume tier and the node's toxicity add-on. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MarketQuote } from "@/lib/engine/types";
import { fixedFromInt } from "@/lib/fixed";
import type { AccountModel } from "@/lib/models";
import type { ConsoleState } from "@/lib/store/state";
import { decodeVolume } from "@/lib/volume-tier";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { DealTicket } from "./DealTicket";

const volume = decodeVolume({
  tier: 0, matured: "0", pending: "0", progress: [{ capped: "0", days: 0 }], best_price_bounds: { "1": "500000" }, max_resting_orders: 25, requests_per_second: 2,
});
const orders = (n: number): AccountModel["orders"] => Array.from({ length: n }, (_, i) => ({ order_id: i + 1, client_id: i, market: 1, side: "buy" as const, qty: "1", kind: { kind: "limit" as const, price: "1" }, reduce_only: false }));
const account = (resting: number): AccountModel => ({
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: 0n, positions: [], orders: orders(resting),
  requirements: { initialMargin: 0n, maintenanceMargin: 0n, withdrawable: fixedFromInt(10_000), maxLeverage: new Map([[1, fixedFromInt(20)]]) },
  ...(volume === null ? {} : { volume }),
});
const quote = (toxicityBps: number): MarketQuote => ({
  type: "quote", account: "0xabc", market: 1, open: true, reduce_only: false, stress_level: 0, toxicity_bps: toxicityBps, mark: "100000",
  ask: [{ qty: "100", price: "100020" }], bid: [{ qty: "100", price: "99980" }], close: null,
});

function Seed({ resting, toxicityBps, patch }: { resting: number; toxicityBps: number; patch?: Partial<ConsoleState> }) {
  const { store } = useSession();
  store.patch({ account: account(resting), signatures: "checked", selected: 1, quotes: { 1: quote(toxicityBps) }, ...patch });
  return null;
}

const render = (resting = 3, toxicityBps = 0, patch?: Partial<ConsoleState>) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { resting, toxicityBps, patch }), createElement(DealTicket)));

describe("the deal ticket's tier limits", () => {
  it("shows the account's best-price size, leverage and resting orders in the selected market", () => {
    const html = render(3);
    expect(html).toContain("Volume tier 0 limits in BTC-USD");
    expect(html).toContain("Up to $500,000");
    expect(html).toContain("20x");
    expect(html).toContain("3 of 25");
  });
});

describe("the ticket's space for the tier limits", () => {
  it("holds the row with dashes while a connected wallet's account is read, so the size field does not move, and drops it once the read gives no volume", () => {
    const wallet = { address: "0xabc", label: "w" };
    const reading = render(0, 0, { account: null, accountRead: false, wallet });
    expect(reading).toContain("Your volume tier limits in BTC-USD");
    expect(reading).toMatch(/Best-price size<\/dt><dd[^>]*>—</);
    // The same while the page load's wallet is still connecting, and none once the load has settled with no wallet.
    expect(render(0, 0, { account: null, accountRead: false, wallet: null, walletDecided: false })).toContain("Your volume tier limits in BTC-USD");
    expect(render(0, 0, { account: null, accountRead: false, wallet: null, walletDecided: true })).not.toContain("volume tier limits");
    const unsupported = render(0, 0, { account: { ...account(0), volume: undefined }, accountRead: true, wallet });
    expect(unsupported).not.toContain("volume tier");
  });
});

describe("the spread bands in Market info", () => {
  it("are the account's own once the tier table is read, its first band ending at its best-price size, and the listing's before", () => {
    const params = { profitFeeBps: 1_000, closeoutLevelBps: 5_000, totalCapBps: 20_000, totalCapFloor: 0n, stressLevels: [], profitFeeCurve: [], seq: 1 };
    const tiers = [{ threshold: "0", day_divisor: 1, best_price_share_bps: 2500, margin_floor_bps: 500, max_resting_orders: 25, requests_per_second: 2 }];
    const own = render(0, 0, { houseParams: { ...params, volumeTiers: tiers }, pricingCurrent: true });
    expect(own).toContain("Spread by position size, for your account");
    expect(own).toContain("Up to $500K");
    const listed = render(0, 0, { houseParams: params, pricingCurrent: true });
    expect(listed).not.toContain("for your account");
    expect(listed).toContain("Up to $2.00M");
  });
});

describe("the toxicity add-on", () => {
  it("names the add-on the signed quote carries beside the executable spread, and none when it is zero", () => {
    // Market info's own words name the add-on in general; the label is the figure beside the spread.
    expect(render(0, 2)).toMatch(/including a <span[^>]*>\+2 bps<\/span> toxicity add-on on each price/);
    expect(render(0, 0)).not.toContain("including a");
  });
});
