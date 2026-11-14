/**
 * The trading dev scenario: the console's store and actions against a real dev node with mock
 * custody and feeds. A fixed-key wallet funds itself, declares eligibility, and trades at the
 * executable quotes the node streams: a market order at the shown quote with a slippage bound, a
 * resting order and its cancel, and a reduce-only close at the streamed closing price. Then the
 * spreads in tenths of a bp and the holding-time fee: BTC-USD and EUR-USD partial closes priced as
 * bounds the fills meet, a listing notice from the house state, a restart that moves the mock mids
 * and closes out an ETH-USD short, and whole closes after the fee's curve priced exactly.
 */

import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ClosePreview } from "../../src/lib/close-preview";
import type { Fill, MarketId, Side } from "../../src/lib/engine/types";
import { ACCOUNT } from "../../src/lib/engine/wallet-kit";
import { positionFee } from "../../src/lib/fee-words";
import { absFixed, fixedFromWire, fixedToWire, parseFixed, type Fixed } from "../../src/lib/fixed";
import { LAUNCH_CURVE } from "../../src/lib/holding-fee";
import { describeEvent } from "../../src/lib/messages";
import { closingPrice } from "../../src/lib/quotes";
import { describeNotice, spreadRate } from "../../src/lib/spread-bands";
import { attestEligibility, authorizeBrowser, cancelOrder, placeOrder } from "../../src/lib/store/actions";
import { admin, curl, marketOf, restartNode, sizeFor, startRig, ticketFor, until, WORK, type Rig } from "./trading-kit";

const [BTC, ETH, EUR] = [1, 2, 10];
/** Whole USDC the mock-custody dev endpoint credits. */
const FUND = "20000";
/** The fee curve's last hold: from it a close pays the base, which no longer falls. */
const CURVE_END_MS = 900_000;

let rig: Rig;
const snapshot = () => rig.store.getSnapshot();
const position = (id: MarketId) => snapshot().account?.positions.find((p) => p.market === id) ?? null;
const wait = (done: () => boolean, ms?: number, what?: string) => until(rig.store, done, ms, what);

/** The fills the node answered the order `place` sends with. */
async function fillsOf(place: () => Promise<unknown>): Promise<Fill[]> {
  const before = rig.answers.length;
  await place();
  const answer = rig.answers.at(-1);
  if (rig.answers.length !== before + 1 || answer === undefined) throw new Error("the order got no answer");
  return answer.flatMap((event) => (event.type === "fill" ? [event] : []));
}

/** Places a market order of `qty` at the deal ticket's price for it, and returns its one fill and the ticket's figures. */
async function trade(id: MarketId, side: Side, qty: Fixed, reduceOnly = false): Promise<{ fill: Fill; close: ClosePreview | null; mark: string | null }> {
  await wait(() => snapshot().quotes[id] !== undefined, 30_000, `a quote for market ${id}`);
  const mark = snapshot().quotes[id]?.mark ?? null;
  const { prices, close, slippage } = ticketFor(rig.store, id, side, qty);
  if (prices.price === null) throw new Error(`the node quotes no price: ${prices.problem ?? "unknown"}`);
  const fills = await fillsOf(() => placeOrder(rig.store, { market: id, side, qty, kind: { kind: "market", quoted: prices.price ?? 0n, slippageBps: slippage }, reduceOnly }));
  const [fill] = fills;
  if (fills.length !== 1 || fill === undefined) throw new Error(`expected one fill, got ${fills.length}`);
  return { fill, close, mark };
}

/** Waits for the market's next price, so an order placed straight after it fills at the index its quote was read at. */
async function freshPrice(id: MarketId): Promise<void> {
  const was = snapshot().quotes[id]?.mark;
  await wait(() => { const quote = snapshot().quotes[id]; return quote !== undefined && quote.mark !== was && quote.unavailable === undefined; }, 30_000, `a new price for market ${id}`);
}

/** What a fill moves the account's cash by: its realised result less its fee. */
const cashMove = (fill: Fill): Fixed => fixedFromWire(fill.realised_pnl) - fixedFromWire(fill.profit_fee);

beforeAll(async () => { rig = await startRig(); }, 90_000);

afterAll(async () => {
  rig.stop();
  await rig.proxy.close();
});

describe("trading against a dev node", () => {
  it("funds the account and records its eligibility declaration", async () => {
    // The engine holds a never-credited account's deposit pending until its declaration arrives, so the deposit is sent first.
    curl("/v1/dev/deposit", { account: ACCOUNT, amount: FUND });
    await attestEligibility(rig.store, "eligible_client");
    await wait(() => snapshot().eligibility === "eligible_client");
    await wait(() => snapshot().account?.balance === parseFixed(FUND));
    // Trading never registers a key: the setup popup's one signature does, and orders then sign with it.
    expect(await authorizeBrowser(rig.store, "setup")).toBe(true);
  });

  it("fills a market order at the streamed quote, sent as the quoted price with the slippage bound", async () => {
    await wait(() => snapshot().quotes[BTC] !== undefined);
    const qty = sizeFor(marketOf(rig.store, BTC), 60_000);
    const { prices, slippage } = ticketFor(rig.store, BTC, "buy", qty);
    // The expected price is the qualifying raw step of the streamed ladder, read without the ticket's own pricing helpers.
    const step = snapshot().quotes[BTC]?.ask.find((s) => fixedFromWire(s.qty) >= qty);
    expect(step?.price).toBe(prices.price === null ? undefined : fixedToWire(prices.price));
    await placeOrder(rig.store, { market: BTC, side: "buy", qty, kind: { kind: "market", quoted: prices.price ?? 0n, slippageBps: slippage }, reduceOnly: false });
    // The bound the wire carries is the fixture's choice under the market's cap, computed without the ticket's helper.
    expect(rig.posted.at(-1)?.body.kind).toEqual({ kind: "market", quoted: fixedToWire(prices.price ?? 0n), max_slippage_bps: Math.min(25, marketOf(rig.store, BTC).view.max_slippage_bps) });
    await wait(() => (position(BTC)?.qty ?? 0n) > 0n);
  });

  it("rests a limit order and cancels it", async () => {
    const trigger = ((marketOf(rig.store, BTC).mark ?? 0n) * 85n) / 100n;
    await placeOrder(rig.store, { market: BTC, side: "buy", qty: parseFixed("0.1") ?? 0n, kind: { kind: "limit", price: trigger }, reduceOnly: false });
    await wait(() => (snapshot().account?.orders.length ?? 0) > 0);
    const order = snapshot().account?.orders[0];
    if (order === undefined) throw new Error("no resting order");
    await cancelOrder(rig.store, order.order_id);
    await wait(() => (snapshot().account?.orders.length ?? 0) === 0);
  });

  it("closes the position at the streamed closing price, reduce only", async () => {
    await wait(() => { const quote = snapshot().quotes[BTC]; const held = position(BTC); return quote !== undefined && held !== null && closingPrice(quote, "sell", absFixed(held.qty)) !== null; });
    const qty = absFixed(position(BTC)?.qty ?? 0n);
    const close = snapshot().quotes[BTC]?.close;
    const { prices } = ticketFor(rig.store, BTC, "sell", qty);
    // The ticket's price for the whole position is the quote's raw close instruction.
    expect(close === null || close === undefined ? null : [close.side, fixedFromWire(close.qty), close.price]).toEqual(["sell", qty, fixedToWire(prices.price ?? 0n)]);
    expect(prices.exactClose).toBe(true);
    await trade(BTC, "sell", qty, true);
    expect(rig.posted.at(-1)?.body).toMatchObject({ side: "sell", qty: fixedToWire(qty), reduce_only: true });
    await wait(() => position(BTC) === null);
  });
});

describe("spreads in tenths of a bp and the holding-time fee", () => {
  /** What each market holds after its partial close. */
  const left: Record<number, Fixed> = {};

  it("reads the stress levels and the fee curve from the house state, and EUR-USD's bands and spread to the tenth of a bp", async () => {
    await wait(() => snapshot().houseParams !== null, 30_000, "the house state");
    expect(snapshot().houseParams).toMatchObject({ profitFeeBps: 1_000, profitFeeCurve: LAUNCH_CURVE });
    expect(snapshot().houseParams?.stressLevels.map((level) => [level.size_spread_multiplier_bps, level.min_spread_bps])).toEqual([[10_000, 0], [20_000, 2], [40_000, 10]]);
    const eur = marketOf(rig.store, EUR);
    expect(eur.view.spread_tiers.map(spreadRate)).toEqual(["0.4 bps", "0.8 bps", "1.6 bps"]);
    await wait(() => snapshot().quotes[EUR] !== undefined, 30_000, "a EUR-USD quote");
    // 0.4 bp each side of the mark, each rounded up to a raw unit: 0.8 bp across.
    expect(ticketFor(rig.store, EUR, "buy", sizeFor(eur, 10_000)).prices.spreadTenths).toBe(8);
  });

  it("opens BTC-USD and EUR-USD, and fills each partial close at or better than its preview, which is labelled a bound", async () => {
    for (const [id, dollars] of [[BTC, 60_000], [EUR, 100_000]] as const) {
      const qty = sizeFor(marketOf(rig.store, id), dollars);
      const { fill: open } = await trade(id, "buy", qty);
      if (id === EUR) expect(describeEvent({ type: "fill", ...open }, () => "EUR-USD")).toContain("(spread 0.4 bps)");
      await wait(() => position(id)?.closeFee !== null && position(id)?.qty === qty, 30_000, `the ${id} position's close fee`);
      await freshPrice(id);
      const half = qty / 2n - ((qty / 2n) % 1_000n);
      const { fill, close } = await trade(id, "sell", half, true);
      if (close === null) throw new Error("the ticket shows no close preview");
      expect(close.exact).toBe(false);
      expect(fixedFromWire(fill.price)).toBeGreaterThanOrEqual(close.price);
      expect(fixedFromWire(fill.realised_pnl)).toBeGreaterThanOrEqual(close.realised);
      expect(cashMove(fill)).toBeGreaterThanOrEqual(close.net);
      expect(fill.profit_fee_bps ?? Infinity).toBeLessThanOrEqual(close.feeBps);
      left[id] = qty - half;
      await wait(() => position(id)?.qty === qty - half, 30_000, `the ${id} position after its partial close`);
    }
  }, 120_000);

  it("shows a listing notice the operator announces for BTC-USD, read from the house state", async () => {
    const spec = `${WORK}/btc-notice.toml`;
    writeFileSync(spec, `id = 1\nsymbol = "BTC-USD"\nasset_class = "crypto"\nmax_slippage_bps = 25\nhouse_cap_bps = 3000\nmargin_tiers = [{ bps = 100 }]\nspread_tiers = [{ up_to = "2000000", tenth_bps = 30 }, { up_to = "10000000", tenth_bps = 60 }, { tenth_bps = 120 }]\nschedule = { kind = "always_open" }\nprice_rules = { max_age_ms = 10000, max_divergence_bps = 25, min_sources = 2 }\nfinancing = { benchmark = "SOFR", markup_bps = 500, day_basis = 365 }\n`);
    const effective = new Date(Date.now() + 8 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
    admin(["announce-listing", "1", "--spreads-from", spec, "--effective-at", effective]);
    await wait(() => snapshot().listingNotices[BTC] !== undefined, 30_000, "the listing notice");
    const notice = snapshot().listingNotices[BTC];
    expect(notice === undefined ? [] : describeNotice(notice)).toEqual([expect.stringMatching(/the spread bands may become 3 bps up to \$2\.00M, 6 bps \$2\.00M to \$10\.0M, 12 bps above \$10\.0M\.$/)]);
  });

  it("restarts the node with the mock mids raised, and closes out an ETH-USD short past its margin, leaving the others open", async () => {
    const account = snapshot().account;
    if (account === null) throw new Error("no account");
    // About 70x the free equity: a 1% rise takes it below half its margin, and closing it leaves the account above.
    const dollars = Math.min(1_400_000, Number((account.equity - account.margin) / 1_000_000_000n) * 70);
    await trade(ETH, "sell", sizeFor(marketOf(rig.store, ETH), dollars));
    await wait(() => (position(ETH)?.qty ?? 0n) < 0n);
    const raised = (id: MarketId, bps: bigint) => { const mark = marketOf(rig.store, id).mark ?? 0n; return mark + (mark * bps) / 10_000n; };
    await restartNode({ [BTC]: raised(BTC, 50n), [EUR]: raised(EUR, 50n), [ETH]: raised(ETH, 100n) });
    await wait(() => position(ETH) === null && snapshot().history.some((e) => e.type === "close_out"), 120_000, "the close-out");
    expect(snapshot().notices.account?.text).toContain("closed out");
    expect([position(BTC) !== null, position(EUR) !== null]).toEqual([true, true]);
  }, 180_000);

  it("after the curve's fifteen minutes, closes BTC-USD and EUR-USD whole at their previews: the price, the fee and the cash move", async () => {
    for (const id of [BTC, EUR]) {
      // The base from the curve's end, when the rate no longer falls: the account read and the console's clock agree on it.
      await wait(() => { const held = position(id); const fee = held === null ? null : positionFee(held.closeFee, snapshot().houseParams, snapshot().now); return fee !== null && fee.holdMs >= CURVE_END_MS && fee.fallsAt === null; }, CURVE_END_MS + 60_000, `market ${id} past the fee's curve`);
      await freshPrice(id);
      const qty = absFixed(position(id)?.qty ?? 0n);
      expect(qty).toBe(left[id]);
      const before = snapshot().account?.balance ?? 0n;
      const { fill, close, mark } = await trade(id, "sell", qty, true);
      if (close === null) throw new Error("the ticket shows no close preview");
      // The index the quote was read at is the fill's; past it, no preview could be exact.
      expect(fill.index).toBe(mark);
      expect(close).toMatchObject({ exact: true, whole: true, feeBps: 1_000 });
      expect([fill.price, fill.realised_pnl, fill.profit_fee, fill.profit_fee_bps]).toEqual([fixedToWire(close.price), fixedToWire(close.realised), fixedToWire(close.fee), close.feeBps]);
      // The mids were raised, so each close realises a gain and pays a tenth of it.
      expect(close.realised).toBeGreaterThan(0n);
      await wait(() => position(id) === null, 30_000, `market ${id} closed`);
      expect([cashMove(fill), (snapshot().account?.balance ?? 0n) - before]).toEqual([close.net, close.net]);
    }
  }, CURVE_END_MS * 2 + 120_000);
});
