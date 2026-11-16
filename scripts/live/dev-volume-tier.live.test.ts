/**
 * The volume tier dev scenario: the console's store and actions against a real dev node whose genesis names a
 * tier table a fresh wallet climbs in minutes (`TRADING_SCENARIO=tiers scripts/dev-trading.sh`). A fresh wallet
 * funds itself and starts at tier 0, where the account read, the tier panel, the deal ticket and the withdraw form
 * state the same figures. It is stopped at the ticket past its leverage and its resting-order limit, refused by the
 * node past the order limit, and shown the tier's request rate when it sends faster. It then trades $60,000 of
 * BTC-USD, which counts once held for a minute and takes tier 1, whose best-price size, leverage, limits and
 * withdrawable cash replace tier 0's in every figure the screens show, and withdraws.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freeCash, requirementOf, withdrawableOf } from "../../src/lib/account-figures";
import type { AccountView } from "../../src/lib/engine/types";
import { ACCOUNT } from "../../src/lib/engine/wallet-kit";
import { fixedFromInt, fixedFromWire, parseFixed } from "../../src/lib/fixed";
import { describeBestPrice, describeBoost, describeDiscount, describeNextTier, orderLimitProblem, ticketLimits, tierBenefits, tierStanding } from "../../src/lib/tier-view";
import { accountFeeTerms, currentParams, positionFeeNow } from "../../src/lib/ticket-figures";
import { cancelOrder, attestEligibility, authorizeBrowser, placeOrder, withdraw } from "../../src/lib/store/actions";
import { formatLeverage } from "../../src/lib/volume-tier";
import { curl, marketOf, sizeFor, startRig, ticketFor, until, type Rig } from "./trading-kit";

const BTC = 1;
const FUND = "10000";
/** What the scenario trades to pass tier 1's threshold. */
const TRADED = 60_000;
/** The counted volume that takes tier 1 in this node's table (`scripts/dev-trading.sh`). */
const TIER_1 = 50_000;

let rig: Rig;
const snapshot = () => rig.store.getSnapshot();
const wait = (done: () => boolean, ms?: number, what?: string) => until(rig.store, done, ms, what);
/** The account read as the node serves it, verified by the client: what every screen's figure must equal. */
const read = (): Promise<AccountView> => rig.store.deps.client.account(ACCOUNT);
const standing = () => {
  const found = tierStanding(snapshot().account, currentParams(snapshot()));
  if (found === null) throw new Error("the account read gave no volume standing");
  return found;
};

beforeAll(async () => { rig = await startRig(); }, 90_000);

afterAll(async () => {
  rig.stop();
  await rig.proxy.close();
});

describe("a fresh wallet at tier 0", () => {
  it("funds the account, records its declaration and authorizes the browser", async () => {
    curl("/v1/dev/deposit", { account: ACCOUNT, amount: FUND });
    await attestEligibility(rig.store, "eligible_client");
    await wait(() => snapshot().eligibility === "eligible_client");
    await wait(() => snapshot().account?.balance === parseFixed(FUND));
    expect(await authorizeBrowser(rig.store, "setup")).toBe(true);
    await wait(() => snapshot().houseParams?.volumeTiers?.length === 3 && snapshot().pricingCurrent, 30_000, "the house state's tier table");
  });

  it("states one set of figures on the panel, the account strip, the ticket and the withdraw form: the account read's", async () => {
    // The console asks quotes for the selected market, so a trader selects the market to trade it.
    rig.store.select(BTC);
    await wait(() => snapshot().quotes[BTC] !== undefined, 30_000, "a BTC-USD quote");
    const raw = await read();
    const tier = standing();
    expect(tier.tier).toBe(0);
    // The panel: counted and pending volume as read, and the step to tier 1 from the table.
    expect([tier.volume.matured, tier.volume.pending]).toEqual([fixedFromWire(raw.volume?.matured ?? "x"), fixedFromWire(raw.volume?.pending ?? "x")]);
    expect(tier.next).toMatchObject({ tier: 1, volumeLeft: fixedFromInt(TIER_1), daysNeeded: 1 });
    expect(describeNextTier(tier.next ?? (() => { throw new Error("no next tier"); })())).toContain("Tier 1 needs $50,000 more counted volume");
    // The account strip and the withdraw form: the node's requirement and its withdrawable cash, and free cash above the requirement.
    const account = snapshot().account;
    if (account === null) throw new Error("no account");
    expect(requirementOf(account)).toBe(fixedFromWire(raw.initial_margin ?? "x"));
    expect(withdrawableOf(account)).toBe(fixedFromWire(raw.withdrawable ?? "x"));
    expect(freeCash(account)).toBe(account.equity - requirementOf(account));
    // The ticket: the best-price bound and leverage of the read for this market, the order limit of the tier.
    const limits = ticketLimits(account, BTC);
    expect(limits).toMatchObject({ tier: 0, bestPriceBound: fixedFromWire(raw.volume?.best_price_bounds[String(BTC)] ?? "x"), leverage: fixedFromWire(raw.max_leverage?.[String(BTC)] ?? "x"), orderLimit: 3, resting: 0 });
    // Tier 0's 5% floor holds BTC-USD to 20x, and tier 1's 2% to 50x, as the table's benefits state.
    const benefits = tierBenefits(tier, marketOf(rig.store, BTC).view, snapshot().now);
    expect([formatLeverage(benefits?.now.leverage ?? 0n), formatLeverage(benefits?.next?.leverage ?? 0n)]).toEqual(["20x", "50x"]);
    expect(benefits?.now.bestPriceBound).toBe(limits?.bestPriceBound);
    expect(describeBestPrice(benefits?.next?.bestPriceBound ?? null)).not.toBe(describeBestPrice(benefits?.now.bestPriceBound ?? null));
  });

  it("stops an order past the tier's leverage at the ticket, with the reason", async () => {
    // $10,000 at 20x opens $200,000; an order of $250,000 is past it, and the node's quote declines it for margin.
    const qty = sizeFor(marketOf(rig.store, BTC), 250_000);
    await wait(() => ticketFor(rig.store, BTC, "buy", qty).prices.problem !== null, 30_000, "the ticket's reason");
    const { prices } = ticketFor(rig.store, BTC, "buy", qty);
    expect(prices.problemIsSize).toBe(true);
    expect(prices.problem).toContain("Volume tier 0 allows up to 20x leverage here.");
    // An order inside it has no problem.
    expect(ticketFor(rig.store, BTC, "buy", sizeFor(marketOf(rig.store, BTC), 150_000)).prices.problem).toBeNull();
  });

  it("stops a resting order past the tier's limit at the ticket, and the node refuses one sent anyway", async () => {
    const trigger = ((marketOf(rig.store, BTC).mark ?? 0n) * 50n) / 100n;
    const order = { market: BTC, side: "buy" as const, qty: parseFixed("0.1") ?? 0n, kind: { kind: "limit" as const, price: trigger }, reduceOnly: false };
    for (let i = 0; i < 3; i += 1) {
      expect(await placeOrder(rig.store, order)).toBe(true);
      await wait(() => (snapshot().account?.orders.length ?? 0) === i + 1);
    }
    const limits = ticketLimits(snapshot().account, BTC);
    expect(limits).toMatchObject({ orderLimit: 3, resting: 3 });
    expect(orderLimitProblem(limits, true)).toBe("You have 3 open orders, the most for volume tier 0. Cancel one to place another, or trade more to reach a higher tier.");
    expect(orderLimitProblem(limits, false)).toBeNull();
    // Sent anyway, the node's own refusal names the tier and its limit, at the control that sent it.
    expect(await placeOrder(rig.store, order)).toBe(false);
    expect(snapshot().notices.ticket?.text).toBe("You already have 3 open orders, the most for volume tier 0. Cancel one to place another, or trade more to reach a higher tier.");
    // The orders above spent the tier's burst of requests; the cancels wait for it to refill.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    for (const resting of snapshot().account?.orders ?? []) {
      await cancelOrder(rig.store, resting.order_id);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await wait(() => (snapshot().account?.orders.length ?? 0) === 0, 30_000, `the orders cancelled (429s: ${JSON.stringify(rig.limited)})`);
  });

  it("shows the tier's request rate at the control when requests come faster than it admits, and no toast", async () => {
    // Tier 0 admits 3 requests a second with a burst of two seconds of them: a run of cancels past that meets 429.
    let text: string | undefined;
    for (let i = 0; i < 40 && text === undefined; i += 1) {
      await cancelOrder(rig.store, 999_999);
      text = snapshot().notices.orders?.text.startsWith("Requests are coming faster") ? snapshot().notices.orders?.text : undefined;
    }
    expect(text, `the 429s the node answered: ${JSON.stringify(rig.limited)}`).toBe("You're sending requests faster than volume tier 0 allows, which is 3 a second. Nothing was done. Wait a moment and try again.");
    // The tier's own refusal is signed by the enclave, so the client reads the tier and rate from it.
    expect(rig.limited.some((answer) => answer.signed && answer.body.includes('"tier":0'))).toBe(true);
    // The burst refills; the next request is admitted.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  });
});

describe("trading up to tier 1", () => {
  it("counts $60,000 once it has been held for a minute: tier 1, with its best-price size, leverage and limits", async () => {
    const qty = sizeFor(marketOf(rig.store, BTC), TRADED);
    const { prices, slippage } = ticketFor(rig.store, BTC, "buy", qty);
    if (prices.price === null) throw new Error(`the node quotes no price: ${prices.problem ?? "unknown"}`);
    expect(await placeOrder(rig.store, { market: BTC, side: "buy", qty, kind: { kind: "market", quoted: prices.price, slippageBps: slippage }, reduceOnly: false })).toBe(true);
    // Pending first: the opening volume counts only after the hold, so no tier benefit is granted early.
    await wait(() => (snapshot().account?.volume?.pending ?? 0n) > 0n);
    expect(standing()).toMatchObject({ tier: 0 });
    expect(standing().volume.matured).toBe(0n);
    await wait(() => standing().tier === 1, 150_000, "tier 1");
    const raw = await read();
    expect(raw.volume?.tier).toBe(1);
    const tier = standing();
    expect(tier.volume.matured).toBe(fixedFromWire(raw.volume?.matured ?? "x"));
    const limits = ticketLimits(snapshot().account, BTC);
    // Best price now ends at half of BTC-USD's first bound, leverage is 50x at the 2% floor, and the tier rests 5 orders.
    expect(limits).toMatchObject({ tier: 1, orderLimit: 5, leverage: fixedFromInt(50), bestPriceBound: fixedFromWire(raw.volume?.best_price_bounds[String(BTC)] ?? "x") });
    expect(tier.next).toMatchObject({ tier: 2 });
    expect(tierBenefits(tier, marketOf(rig.store, BTC).view, snapshot().now)?.now.bestPriceBound).toBe(limits?.bestPriceBound);
  }, 240_000);
});

describe("the V68 benefits at tier 1", () => {
  it("states the tier's fee discount, financing discount and emissions boost as the account read gives them, and the next tier's from the table", async () => {
    const raw = await read();
    expect([raw.volume?.fee_discount_bps, raw.volume?.financing_discount_bps, raw.volume?.emissions_boost_bps]).toEqual([1_000, 500, 1_000]);
    const tier = standing();
    expect([tier.volume.feeDiscountBps, tier.volume.financingDiscountBps, tier.volume.emissionsBoostBps]).toEqual([1_000, 500, 1_000]);
    const benefits = tierBenefits(tier, marketOf(rig.store, BTC).view, snapshot().now);
    expect([describeDiscount(benefits?.now.feeDiscountBps ?? -1), describeDiscount(benefits?.next?.feeDiscountBps ?? -1)]).toEqual(["10%", "20%"]);
    expect([describeBoost(benefits?.now.emissionsBoostBps ?? -1), describeBoost(benefits?.next?.emissionsBoostBps ?? -1)]).toEqual(["1.1x", "1.25x"]);
  });

  it("prices a close at the rate the account read gives, from the base less the tier's discount under the curve", async () => {
    const raw = await read();
    const position = snapshot().account?.positions.find((p) => p.market === BTC);
    if (position === undefined) throw new Error("no BTC-USD position");
    const params = currentParams(snapshot());
    const base = params === null ? 0 : params.profitFeeBps;
    // The discounted base the console's fee terms run from is the engine's: the base less 10%, rounded up to the bp.
    expect(accountFeeTerms(snapshot())?.profitFeeBps).toBe(Math.ceil((base * 9_000) / 10_000));
    // A few minutes in, the curve is above the base, so the node's served rate and the console's own run agree.
    expect(positionFeeNow(snapshot(), position)?.feeBps).toBe(raw.close_fees?.[String(BTC)]?.fee_bps);
  });
});

describe("withdrawing at tier 1", () => {
  it("takes the withdrawable cash the account read gives, and the figures follow the withdrawal", async () => {
    const before = await read();
    const account = snapshot().account;
    if (account === null) throw new Error("no account");
    // With the position open, the requirement at tier 1's floor is what withdrawable cash must leave.
    expect(withdrawableOf(account)).toBe(fixedFromWire(before.withdrawable ?? "x"));
    const amount = fixedFromInt(100);
    expect(withdrawableOf(account)).toBeGreaterThan(amount);
    expect(await withdraw(rig.store, amount)).toBe(true);
    await wait(() => (snapshot().account?.balance ?? 0n) === account.balance - amount, 30_000, "the balance after the withdrawal");
    const after = await read();
    const now = snapshot().account;
    if (now === null) throw new Error("no account");
    expect(withdrawableOf(now)).toBe(fixedFromWire(after.withdrawable ?? "x"));
    // More than is withdrawable is refused with what is available, at the withdraw form.
    expect(await withdraw(rig.store, withdrawableOf(now) + fixedFromInt(1_000))).toBe(false);
    expect(snapshot().notices.withdraw?.text).toContain("You can withdraw up to");
  });
});
