/**
 * The portfolio margin dev scenario (`TRADING_SCENARIO=portfolio scripts/dev-trading.sh`): the console's store and actions
 * against a real dev node at the engine's V84, under the dev genesis's BTC-USD and ETH-USD fixture group with a 5% margin
 * floor at tier 0. A funded wallet's lone BTC-USD long shows no portfolio detail and asks no preview. An ETH-USD short sized to
 * hedge it, and a larger BTC-USD long, are previewed by the node, which the ticket's line states, and the account then earns
 * an offset its summary line states from the read. Closing the ETH-USD leg alone is refused at the ticket from the preview and
 * at its Close from the exact close quote, as the node then refuses it. A buy stop on that leg fills when the node restarts
 * with ETH-USD's mid above it, though an order could not close it; then a smaller pair, reopened, closes whole from Close hedge.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLOSE_SLIPPAGE_BPS, planGroupClose } from "../../src/lib/close-all";
import type { Side } from "../../src/lib/engine/types";
import { ACCOUNT } from "../../src/lib/engine/wallet-kit";
import { absFixed, fixedFromWire, fixedToWire, formatUsd, parseFixed, type Fixed } from "../../src/lib/fixed";
import { roundToPlaces } from "../../src/lib/fixed-rounding";
import { creditedGroups } from "../../src/lib/portfolio";
import { describeOffsetSummary, TRIGGERED_ORDER_NOTE } from "../../src/lib/portfolio-words";
import { attestEligibility, authorizeBrowser, placeOrder } from "../../src/lib/store/actions";
import { closeAll } from "../../src/lib/store/batch-actions";
import { ticketFigures } from "../../src/lib/ticket-figures";
import { closeDeclined, isMarginRefusal, previewRequest, triggeredNote } from "../../src/lib/ticket-portfolio";
import { curl, marketOf, restartNode, sizeFor, SLIPPAGE_BPS, startRig, until, type Rig } from "./trading-kit";

const BTC = 1;
const ETH = 2;
const FUND = "30000";

let rig: Rig;
const snapshot = () => rig.store.getSnapshot();
const wait = (done: () => boolean, ms?: number, what?: string) => until(rig.store, done, ms, what);
const held = (market: number): Fixed => snapshot().account?.positions.find((p) => p.market === market)?.qty ?? 0n;
const order = (side: Side, qty: Fixed) => ({ side, qty, slippageBps: SLIPPAGE_BPS, resting: false, triggerPrice: null });

/** Selects `market` and waits for its live quote, as a trader does before trading it. */
async function quoted(market: number): Promise<void> {
  rig.store.select(market);
  await wait(() => snapshot().quotes[market] !== undefined && snapshot().quotes[market]?.unavailable === undefined, 60_000, `a quote for market ${market}`);
}

/** The ticket's figures for a market order, with the node's preview of it when the order concerns a hedge, as `DealTicket` reads them. */
async function ticket(market: number, side: Side, qty: Fixed) {
  const model = marketOf(rig.store, market);
  const request = previewRequest(snapshot(), model, order(side, qty));
  const answer = request === null ? null : await rig.store.deps.client.preview(request);
  return { request, answer, figures: ticketFigures(snapshot(), model, order(side, qty), request === null ? null : { answer: answer ?? undefined }) };
}

/** Places a market order at the ticket's price for its side, and waits for the position it leaves. */
async function trade(market: number, side: Side, qty: Fixed): Promise<void> {
  const { figures } = await ticket(market, side, qty);
  expect(figures.prices.problem).toBeNull();
  const before = held(market);
  expect(await placeOrder(rig.store, { market, side, qty, kind: { kind: "market", quoted: figures.prices.price ?? 0n, slippageBps: SLIPPAGE_BPS }, reduceOnly: false })).toBe(true);
  const after = before + (side === "buy" ? qty : -qty);
  await wait(() => held(market) === after, 30_000, `the position in market ${market}`);
}

beforeAll(async () => { rig = await startRig(); }, 90_000);

afterAll(async () => {
  rig.stop();
  await rig.proxy.close();
});

describe("portfolio margin against a dev node", () => {
  it("funds the account, records its declaration and authorizes the browser", async () => {
    curl("/v1/dev/deposit", { account: ACCOUNT, amount: FUND });
    await attestEligibility(rig.store, "eligible_client");
    await wait(() => snapshot().account?.balance === parseFixed(FUND));
    expect(await authorizeBrowser(rig.store, "setup")).toBe(true);
  });

  it("shows a lone BTC-USD long no portfolio detail and asks the node nothing", async () => {
    await quoted(BTC);
    await trade(BTC, "buy", sizeFor(marketOf(rig.store, BTC), 100_000));
    const account = snapshot().account;
    expect(account?.portfolio?.groups.map((g) => [g.name, g.members, g.offset])).toEqual([["crypto", [BTC], 0n]]);
    expect(creditedGroups(account?.portfolio)).toEqual([]);
    expect((await ticket(BTC, "buy", sizeFor(marketOf(rig.store, BTC), 10_000))).request).toBeNull();
  });

  it("previews an ETH-USD short that hedges it, states the margin after, and the account then earns an offset", async () => {
    await quoted(ETH);
    const qty = sizeFor(marketOf(rig.store, ETH), 512_000);
    const { request, answer, figures } = await ticket(ETH, "sell", qty);
    expect(request).toEqual({ account: ACCOUNT, market: ETH, side: "sell", qty: fixedToWire(qty), reduceOnly: false });
    expect(answer?.refused).toBeNull();
    expect(figures.offset?.line).toBe(`After this order, your initial margin would be ${formatUsd(fixedFromWire(answer?.initial_margin ?? ""))} and your equity ${formatUsd(fixedFromWire(answer?.equity ?? ""))}.`);
    await trade(ETH, "sell", qty);
    await quoted(BTC);
    const add = sizeFor(marketOf(rig.store, BTC), 540_000);
    const grown = await ticket(BTC, "buy", add);
    expect([grown.request?.market, grown.answer?.refused, grown.figures.offset?.line?.startsWith("After this order")]).toEqual([BTC, null, true]);
    await trade(BTC, "buy", add);
    const read = await rig.store.deps.client.account(ACCOUNT);
    const offset = fixedFromWire(read.portfolio_margin?.groups.crypto?.offset ?? "0");
    expect(offset).toBeGreaterThan(0n);
    await wait(() => creditedGroups(snapshot().account?.portfolio).length === 1, 30_000, "the credited hedge");
    const account = snapshot().account;
    if (account?.portfolio === undefined) throw new Error("no portfolio read");
    expect(describeOffsetSummary(account.margin, account.portfolio)).toMatch(/^Your hedged positions reduce your margin from \$[\d,.]+ to \$[\d,.]+\. Your account will be closed out if its equity falls below \$[\d,.]+\.$/);
  });

  it("refuses closing the ETH-USD leg alone at the ticket and at its Close, as the node does", async () => {
    await quoted(ETH);
    const qty = absFixed(held(ETH));
    const { answer, figures } = await ticket(ETH, "buy", qty);
    expect(answer?.refused?.kind).toBe("insufficient_margin");
    expect(figures.prices.problem).toMatch(/^Insufficient margin\. This order requires \$[\d,.]+ of margin, and your equity is \$[\d,.]+\. To close the whole hedge, use Close hedge in the positions panel\.$/);
    await wait(() => isMarginRefusal(closeDeclined(snapshot().quotes[ETH], "buy", qty)), 30_000, "the close quote's decline");
    const posted = rig.posted.length;
    expect(await placeOrder(rig.store, { market: ETH, side: "buy", qty, kind: { kind: "market", quoted: figures.prices.price ?? 0n, slippageBps: SLIPPAGE_BPS }, reduceOnly: true })).toBe(false);
    expect([rig.posted.length, rig.answers.at(-1)?.some((e) => e.type === "order_rejected" && e.reason.kind === "insufficient_margin")]).toEqual([posted + 1, true]);
    expect(held(ETH)).toBe(-qty);
  });

  it("fills a buy stop on the ETH-USD leg when it triggers, which an order could not, and leaves the BTC-USD long", async () => {
    const qty = absFixed(held(ETH));
    const mark = marketOf(rig.store, ETH).mark ?? 0n;
    const trigger = roundToPlaces(mark + mark / 100n, 2, "toward-zero");
    expect(triggeredNote(snapshot().account, ETH, { side: "buy", resting: true }, false)).toBe(TRIGGERED_ORDER_NOTE);
    expect(await placeOrder(rig.store, { market: ETH, side: "buy", qty, kind: { kind: "stop", price: trigger }, reduceOnly: false })).toBe(true);
    await restartNode({ [ETH]: mark + mark / 50n });
    await wait(() => snapshot().account !== null && held(ETH) === 0n, 150_000, "the stop's fill");
    expect(held(BTC)).toBeGreaterThan(0n);
  }, 180_000);

  it("closes a reopened pair whole from Close hedge", async () => {
    const markOf = (id: number) => marketOf(rig.store, id).mark;
    await closeAll(rig.store, planGroupClose([{ market: BTC, symbol: "BTC-USD", open: true, quoted: null, mark: markOf(BTC) }]).targets, CLOSE_SLIPPAGE_BPS);
    await wait(() => held(BTC) === 0n, 30_000, "the BTC-USD close");
    await quoted(BTC);
    await trade(BTC, "buy", sizeFor(marketOf(rig.store, BTC), 100_000));
    await quoted(ETH);
    await trade(ETH, "sell", sizeFor(marketOf(rig.store, ETH), 80_000));
    await wait(() => creditedGroups(snapshot().account?.portfolio).length === 1, 30_000, "the credited hedge");
    // Each member at its mark, as Close hedge prices a member the node does not quote.
    const members = [BTC, ETH].map((id) => ({ market: id, symbol: String(id), open: true, quoted: null, mark: markOf(id) }));
    const { targets, untradable } = planGroupClose(members);
    expect([targets.length, untradable]).toEqual([2, []]);
    await closeAll(rig.store, targets, CLOSE_SLIPPAGE_BPS);
    await wait(() => (snapshot().account?.positions.length ?? 1) === 0, 30_000, "Close hedge");
  });
});

