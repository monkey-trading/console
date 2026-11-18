/**
 * The take-profit and stop-loss dev scenario (`TRADING_SCENARIO=levels scripts/dev-trading.sh`): the console's
 * store and actions against a real dev node at the engine's V79. A funded wallet opens a BTC-USD long from the
 * deal ticket naming both levels, which the position row, the chart and the account read all state, and is
 * stopped at the ticket for a stop loss inside the minimum distance before anything is signed. It moves the stop
 * loss from the position row in one session-signed request, rests a limit order and presses Cancel all, which
 * leaves both levels. The node restarts with BTC-USD's mock mid below the stop loss, which closes the position in
 * one fill below it; then a new long's take profit fills at its level or better after a restart past it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { markersFor } from "../../src/components/ChartPanel";
import type { EngineEvent, Side } from "../../src/lib/engine/types";
import { ACCOUNT } from "../../src/lib/engine/wallet-kit";
import { absFixed, fixedFromWire, fixedToWire, parseFixed, type Fixed } from "../../src/lib/fixed";
import { roundToPlaces } from "../../src/lib/fixed-rounding";
import { checkEditorLevels, type LevelFields } from "../../src/lib/level-check";
import { decodeLevels, NO_LEVELS } from "../../src/lib/levels";
import { describeEvent } from "../../src/lib/messages";
import { closingPrice } from "../../src/lib/quotes";
import { attestEligibility, authorizeBrowser, placeOrder } from "../../src/lib/store/actions";
import { cancelAll } from "../../src/lib/store/batch-actions";
import { setPositionLevels } from "../../src/lib/store/level-actions";
import { ticketFigures } from "../../src/lib/ticket-figures";
import { ticketLevels } from "../../src/lib/ticket-levels";
import { usdConverter } from "../../src/lib/ticket";
import { ticketLimits } from "../../src/lib/tier-view";
import { curl, marketOf, restartNode, sizeFor, SLIPPAGE_BPS, startRig, until, type Rig } from "./trading-kit";

const BTC = 1;
const FUND = "20000";

let rig: Rig;
const snapshot = () => rig.store.getSnapshot();
const wait = (done: () => boolean, ms?: number, what?: string) => until(rig.store, done, ms, what);
const position = () => snapshot().account?.positions.find((p) => p.market === BTC) ?? null;
/** `bps` of BTC-USD's mark away from it, at the market's two places. */
const awayFromMark = (bps: number): Fixed => {
  const mark = marketOf(rig.store, BTC).mark ?? 0n;
  return roundToPlaces(mark + (mark * BigInt(bps)) / 10_000n, 2, "toward-zero");
};
const fields = (takeProfit: Fixed | null, stopLoss: Fixed | null): LevelFields => ({ takeProfit: takeProfit === null ? "" : fixedToWire(takeProfit), stopLoss: stopLoss === null ? "" : fixedToWire(stopLoss) });

/** The deal ticket's figures and levels for a market order, from the same `ticketFigures` and `ticketLevels` `DealTicket` reads. */
function ticket(side: Side, qty: Fixed, typed: LevelFields) {
  const market = marketOf(rig.store, BTC);
  const order = { side, qty, slippageBps: SLIPPAGE_BPS, resting: false, triggerPrice: null };
  const figures = ticketFigures(snapshot(), market, order);
  return { prices: figures.prices, levels: ticketLevels(snapshot(), market, order, typed, figures) };
}

/** Waits for a live BTC-USD quote, as a trader selects the market to trade it. */
async function quoted(): Promise<void> {
  rig.store.select(BTC);
  await wait(() => snapshot().quotes[BTC] !== undefined && snapshot().quotes[BTC]?.unavailable === undefined, 60_000, "a BTC-USD quote");
}

/** The account's newest history event of `kind` that `match` accepts, waiting for the node's history index, which trails its stream. */
async function newest(kind: string, match: (event: EngineEvent) => boolean = () => true): Promise<EngineEvent> {
  const end = Date.now() + 30_000;
  for (;;) {
    const found = (await rig.store.deps.client.history(ACCOUNT, { kind, limit: 5 })).events.find(match);
    if (found !== undefined) return found;
    if (Date.now() > end) throw new Error(`no ${kind} event in the history`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

beforeAll(async () => { rig = await startRig(); }, 90_000);

afterAll(async () => {
  rig.stop();
  await rig.proxy.close();
});

describe("take profit and stop loss against a dev node", () => {
  let stop = 0n;

  it("funds the account, records its declaration and authorizes the browser", async () => {
    curl("/v1/dev/deposit", { account: ACCOUNT, amount: FUND });
    await attestEligibility(rig.store, "eligible_client");
    await wait(() => snapshot().account?.balance === parseFixed(FUND));
    expect(await authorizeBrowser(rig.store, "setup")).toBe(true);
  });

  it("opens a long from the ticket with both levels, which the position row, the chart and the account read all state", async () => {
    await quoted();
    const market = marketOf(rig.store, BTC);
    expect(market.view.min_level_distance_bps).toBe(30);
    const qty = sizeFor(market, 20_000);
    const [take, initialStop] = [awayFromMark(200), awayFromMark(-200)];
    const { prices, levels } = ticket("buy", qty, fields(take, initialStop));
    expect(levels).toMatchObject({ blocked: false, general: null, problems: { take_profit: null, stop_loss: null } });
    expect(levels?.estimates.take_profit).toBeGreaterThan(0n);
    expect(levels?.estimates.stop_loss).toBeLessThan(0n);
    expect(await placeOrder(rig.store, { market: BTC, side: "buy", qty, kind: { kind: "market", quoted: prices.price ?? 0n, slippageBps: SLIPPAGE_BPS }, reduceOnly: false, levels: levels?.named ?? NO_LEVELS })).toBe(true);
    await wait(() => position()?.levels?.stopLoss === initialStop, 30_000, "the position's levels");
    const read = await rig.store.deps.client.account(ACCOUNT);
    expect(read.levels?.[String(BTC)]).toEqual({ take_profit: fixedToWire(take), stop_loss: fixedToWire(initialStop) });
    expect(position()?.levels).toEqual(decodeLevels(read.levels?.[String(BTC)]));
    const lines = markersFor(snapshot(), marketOf(rig.store, BTC)).filter((line) => line.style === "solid");
    expect(lines.map((line) => [line.title, line.price])).toEqual([["Take profit", Number(take) / 1e9], ["Stop loss", Number(initialStop) / 1e9]]);
    stop = initialStop;
  });

  it("stops a stop loss inside the minimum distance at the ticket, naming the distance, and the node refuses it too", async () => {
    const add = parseFixed("0.01") ?? 0n;
    const close = awayFromMark(-10);
    const { prices, levels } = ticket("buy", add, fields(null, close));
    expect(levels?.blocked).toBe(true);
    expect(levels?.problems.stop_loss).toMatch(/^Stop loss too close to the closing price\. In this market, a stop loss on a long position must be at least 0\.3% below/);
    // Sent anyway, past the ticket, the node refuses it as the ticket said.
    const posted = rig.posted.length;
    expect(await placeOrder(rig.store, { market: BTC, side: "buy", qty: add, kind: { kind: "market", quoted: prices.price ?? 0n, slippageBps: SLIPPAGE_BPS }, reduceOnly: false, levels: { takeProfit: null, stopLoss: close } })).toBe(false);
    expect(rig.posted.length).toBe(posted + 1);
    expect(snapshot().notices.ticket?.text).toContain("is too close to the current price. In this market, a take profit or stop loss must be at least 0.3%");
    expect(position()?.levels?.stopLoss).toBe(stop);
  });

  it("moves the stop loss from the position row in one session-signed request", async () => {
    await quoted();
    const held = position();
    if (held === null || held.levels === undefined) throw new Error("no position with levels");
    // The row's closing price: the node's exact whole close, which the quote stream carries once it reflects the position.
    await wait(() => { const quote = snapshot().quotes[BTC]; return quote !== undefined && closingPrice(quote, "sell", absFixed(held.qty)) !== null; }, 30_000, "the position's closing price");
    const market = marketOf(rig.store, BTC);
    const quote = snapshot().quotes[BTC];
    const closing = quote === undefined ? null : closingPrice(quote, "sell", absFixed(held.qty));
    const moved = awayFromMark(-300);
    const check = checkEditorLevels({
      market, qty: held.qty, entry: held.entry, held: held.levels, closing, noClosing: "", capped: null, limits: ticketLimits(snapshot().account, BTC),
      fields: fields(held.levels.takeProfit, moved), toUsdDown: market.mark === null ? null : usdConverter(market.view, market.mark, "down"),
    });
    expect(check).toMatchObject({ changed: true, blocked: false });
    expect(await setPositionLevels(rig.store, BTC, check.named)).toBe(true);
    await wait(() => position()?.levels?.stopLoss === moved, 30_000, "the moved stop loss");
    expect(await newest("position_levels_set", (e) => e.type === "position_levels_set" && e.stop_loss === fixedToWire(moved))).toMatchObject({ take_profit: fixedToWire(held.levels.takeProfit ?? 0n) });
    stop = moved;
  });

  it("rests a limit order, and Cancel all cancels it and leaves both levels", async () => {
    const trigger = awayFromMark(-5_000);
    expect(await placeOrder(rig.store, { market: BTC, side: "buy", qty: parseFixed("0.1") ?? 0n, kind: { kind: "limit", price: trigger }, reduceOnly: false })).toBe(true);
    await wait(() => (snapshot().account?.orders.length ?? 0) === 1, 30_000, "the resting order");
    await cancelAll(rig.store);
    await wait(() => (snapshot().account?.orders.length ?? 1) === 0, 30_000, "Cancel all");
    expect((await rig.store.deps.client.account(ACCOUNT)).levels?.[String(BTC)]).toMatchObject({ stop_loss: fixedToWire(stop) });
  });

  it("closes the whole position in one fill below the stop loss when the node restarts with the mid under it, and History names the stop loss", async () => {
    await restartNode({ [BTC]: stop - stop / 20n });
    await wait(() => snapshot().account !== null && position() === null, 150_000, "the stop loss's close");
    const fired = await newest("position_level_triggered");
    expect(fired).toMatchObject({ level: "stop_loss", price: fixedToWire(stop) });
    const orderId = fired.type === "position_level_triggered" ? fired.order_id : -1;
    const fill = await newest("fill", (e) => e.type === "fill" && e.order_id === orderId);
    expect(fill.type === "fill" ? [fill.position, fixedFromWire(fill.price) < stop] : null).toEqual(["0", true]);
    expect(await newest("position_levels_removed")).toMatchObject({ reason: "stop_loss" });
    expect(describeEvent(fired, () => "BTC-USD")).toMatch(/^The stop loss at [\d,.]+ on BTC-USD was reached, and the whole position was closed$/);
    await wait(() => snapshot().notices.account?.text.startsWith("Your stop loss at") === true, 30_000, "the account notice");
  }, 180_000);

  it("fills a new long's take profit at its level or better once the node restarts with the mid past it", async () => {
    await quoted();
    const market = marketOf(rig.store, BTC);
    const qty = sizeFor(market, 20_000);
    const take = awayFromMark(200);
    const { prices, levels } = ticket("buy", qty, fields(take, null));
    expect(levels?.blocked).toBe(false);
    expect(await placeOrder(rig.store, { market: BTC, side: "buy", qty, kind: { kind: "market", quoted: prices.price ?? 0n, slippageBps: SLIPPAGE_BPS }, reduceOnly: false, levels: levels?.named ?? NO_LEVELS })).toBe(true);
    await wait(() => position()?.levels?.takeProfit === take, 30_000, "the take profit");
    await restartNode({ [BTC]: take + take / 20n });
    await wait(() => snapshot().account !== null && position() === null, 150_000, "the take profit's close");
    const fired = await newest("position_level_triggered", (e) => e.type === "position_level_triggered" && e.level === "take_profit");
    expect(fired).toMatchObject({ price: fixedToWire(take) });
    const orderId = fired.type === "position_level_triggered" ? fired.order_id : -1;
    const fill = await newest("fill", (e) => e.type === "fill" && e.order_id === orderId);
    expect(fill.type === "fill" ? [fill.position, fixedFromWire(fill.price) >= take] : null).toEqual(["0", true]);
    expect(await newest("position_levels_removed", (e) => e.type === "position_levels_removed" && e.reason === "take_profit")).toMatchObject({ take_profit: fixedToWire(take) });
  }, 180_000);
});
