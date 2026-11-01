/** Fills an order against the house at the live quote, or says why it cannot. */

import { absFixed, bpsOf, fixedFromWire, fixedToWire, mulFixed, type Fixed } from "../fixed";
import { metaFor } from "../engine/meta";
import type { EngineEvent, Fill, MarketId, Reject, Side } from "../engine/types";
import { equityOf, houseNav, houseNetNotional, marginOf } from "./accounts";
import { noteEmissionLoss } from "./emissions";
import { adverseBps, executionCost, exceedsSlippage, notionalOf, PROFIT_FEE_BPS, quoteOrder, tieredMargin, type Quote } from "../pricing";
import type { Holding, MockState } from "./state";

export interface FillRequest {
  address: string;
  market: MarketId;
  side: Side;
  qty: Fixed;
  reduceOnly: boolean;
  orderId: number;
  /** The price the client saw and the most it may move against them; absent for a triggered order. */
  slippage?: { quoted: Fixed; maxBps: number };
  /** A close-out skips the checks that stop an order adding risk. */
  liquidation?: boolean;
}

/** A filled order, with any loss beyond the balance that the house wrote off because the account is flat. */
export type FillOutcome = { ok: true; fill: Fill; badDebt: Fixed } | { ok: false; reject: Reject };

const signed = (side: Side, qty: Fixed): Fixed => (side === "buy" ? qty : -qty);

/** The quote for `qty` of `market` on `side` for the account's current holding, with whether it adds risk. */
export function liveQuote(state: MockState, address: string, market: MarketId, side: Side, qty: Fixed): (Quote & { grows: boolean }) | null {
  const runtime = state.markets.get(market);
  if (!runtime) return null;
  return quoteOrder({
    index: runtime.mid, side, baseSpreadBps: metaFor(runtime.listed.spec.symbol).baseSpreadBps, spreadTiers: runtime.listed.spec.spread_tiers,
    stress: runtime.stress, held: state.account(address).positions.get(market)?.qty ?? 0n, qty,
  });
}

/** Applies a signed fill to a holding and returns the realised profit and loss before the fee. */
function applyToHolding(held: Holding, delta: Fixed, price: Fixed): Fixed {
  if (held.qty === 0n || (held.qty > 0n) === (delta > 0n)) {
    const total = absFixed(held.qty) + absFixed(delta);
    held.entry = (absFixed(held.qty) * held.entry + absFixed(delta) * price) / total;
    held.qty += delta;
    return 0n;
  }
  const closing = absFixed(delta) < absFixed(held.qty) ? absFixed(delta) : absFixed(held.qty);
  const pnl = mulFixed(held.qty > 0n ? closing : -closing, price - held.entry);
  held.qty += delta;
  if (held.qty !== 0n && (held.qty > 0n) === (delta > 0n)) held.entry = price;
  return pnl;
}

/**
 * Checks an order against the market, the quote, the account's margin, and the house's cap; then
 * fills it. Every refusal is a typed `Reject`, as the engine logs it.
 */
export function fillOrder(state: MockState, order: FillRequest): FillOutcome {
  const runtime = state.markets.get(order.market);
  const heldNow = state.account(order.address).positions.get(order.market)?.qty ?? 0n;
  // A reduce-only order is clamped to what it can reduce, and refused when it would reduce nothing.
  const reducible = (order.side === "buy") === (heldNow < 0n) ? absFixed(heldNow) : 0n;
  if (order.reduceOnly && !order.liquidation && reducible === 0n) return { ok: false, reject: { kind: "reduce_only" } };
  const req = order.reduceOnly && order.qty > reducible ? { ...order, qty: reducible } : order;
  const account = state.account(req.address);
  if (!runtime) return { ok: false, reject: { kind: "unknown_market" } };
  if (!runtime.open || runtime.halted) return { ok: false, reject: { kind: "market_closed" } };
  const quote = liveQuote(state, req.address, req.market, req.side, req.qty);
  if (!quote) return { ok: false, reject: { kind: "no_price" } };
  const held = account.positions.get(req.market)?.qty ?? 0n;
  const delta = signed(req.side, req.qty);
  const grows = quote.grows;
  if (req.slippage) {
    const cap = Math.min(req.slippage.maxBps, runtime.listed.spec.max_slippage_bps);
    const bps = adverseBps(req.side, req.slippage.quoted, quote.price);
    if (exceedsSlippage(req.side, req.slippage.quoted, quote.price, cap)) {
      const reject: Reject = { kind: "slippage", quoted: fixedToWire(req.slippage.quoted), live: fixedToWire(quote.price), slippage_bps: bps };
      return { ok: false, reject };
    }
  }
  if (!req.liquidation && grows) {
    // The account as the fill leaves it: the spread just paid, and the fee on a profit a reversal realises.
    const spreadLoss = executionCost({ held, entry: account.positions.get(req.market)?.entry ?? null, delta, price: quote.price, index: runtime.mid });
    const refusal = riskRefusal(state, req, runtime.reduceOnly, delta, held, spreadLoss);
    if (refusal) return { ok: false, reject: refusal };
  }
  const holding = account.positions.get(req.market) ?? { qty: 0n, entry: 0n };
  const pnl = applyToHolding(holding, delta, quote.price);
  if (holding.qty === 0n) account.positions.delete(req.market);
  else account.positions.set(req.market, holding);
  const fee = pnl > 0n ? bpsOf(pnl, PROFIT_FEE_BPS) : 0n;
  account.balance += pnl - fee;
  state.houseCash += fee - pnl;
  // A realised loss is eligible weight for the open emission period, as the engine weights it (emissions.rs).
  if (pnl < 0n) noteEmissionLoss(state, req.address, -pnl);
  // As the engine does, a loss beyond the balance is written off against the house only once the account is flat.
  let badDebt = 0n;
  if (account.balance < 0n && account.positions.size === 0) {
    badDebt = -account.balance;
    state.houseCash -= badDebt;
    account.balance = 0n;
  }
  return {
    ok: true,
    badDebt,
    fill: {
      account: req.address, order_id: req.orderId, market: req.market, side: req.side,
      qty: fixedToWire(req.qty), price: fixedToWire(quote.price), index: fixedToWire(runtime.mid),
      spread_bps: quote.spreadBps, realised_pnl: fixedToWire(pnl), profit_fee: fixedToWire(fee),
      position: fixedToWire(holding.qty), liquidation: req.liquidation ?? false,
    },
  };
}

/** The refusal for an order that adds risk, or `null` when margin, capacity, and the flags allow it. */
function riskRefusal(state: MockState, req: FillRequest, reduceOnly: boolean, delta: Fixed, held: Fixed, spreadLoss: Fixed): Reject | null {
  const runtime = state.markets.get(req.market);
  const account = state.account(req.address);
  if (!runtime) return { kind: "unknown_market" };
  if (reduceOnly || req.reduceOnly) return { kind: "reduce_only" };
  const spec = runtime.listed.spec;
  if (notionalOf(req.qty, runtime.mid) < fixedFromWire(spec.min_order_notional)) {
    return { kind: "invalid_order", reason: `below the minimum order of ${spec.min_order_notional} USD` };
  }
  const current = tieredMargin(spec.margin_tiers, mulFixed(held, runtime.mid));
  const after = marginOf(state, account) - current + tieredMargin(spec.margin_tiers, mulFixed(held + delta, runtime.mid));
  // The check runs on the account as the fill leaves it: the spread just paid comes off equity first.
  const equity = equityOf(state, account) - spreadLoss;
  if (equity < after) return { kind: "insufficient_margin", equity: fixedToWire(equity), required: fixedToWire(after) };
  const net = houseNetNotional(state, req.market);
  const netAfter = net - mulFixed(delta, runtime.mid);
  const cap = bpsOf(houseNav(state), spec.house_cap_bps);
  if (absFixed(netAfter) > absFixed(net) && absFixed(netAfter) > cap) return { kind: "house_capacity" };
  return null;
}

/** The events a fill produces. */
export function fillEvents(fill: Fill, badDebt: Fixed = 0n): EngineEvent[] {
  const events: EngineEvent[] = [{ type: "fill", ...fill }];
  if (badDebt > 0n) events.push({ type: "bad_debt", account: fill.account, amount: fixedToWire(badDebt) });
  return events;
}
