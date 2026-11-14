/** Fills an order against the house at the live price, or says why it cannot. */

import { absFixed, bpsOf, fixedFromWire, fixedToWire, mulFixed, type Fixed } from "../fixed";
import { metaFor } from "../engine/meta";
import type { EngineEvent, Fill, MarketId, Reject, Side } from "../engine/types";
import { mulRounded, roundDiv } from "../fixed-rounding";
import { feeAt, lastHold, openedAfter, profitFee } from "../holding-fee";
import { equityOf, houseNav, houseNetNotional, marginOf } from "./accounts";
import { recordEmissionResult } from "./emissions";
import { adverseBps, executionCost, exceedsSlippage, notionalOf, priceOrder, tieredMargin, USD, type Priced } from "../pricing";
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

/**
 * The price `qty` of `market` on `side` pays for the account's current holding, as the engine prices it
 * from V52 (`pricing.ts`): the market's stress level from the mock's parameters, no toxicity add-on (the
 * mock scores none), and its close-spread ceiling. Null for a market the mock does not list.
 */
export function liveQuote(state: MockState, address: string, market: MarketId, side: Side, qty: Fixed): Priced | null {
  const runtime = state.markets.get(market);
  if (!runtime) return null;
  const level = state.params.stressLevels[runtime.stress] ?? state.params.stressLevels[0];
  if (level === undefined) throw new Error("the mock's parameters list no stress level");
  return priceOrder({
    mid: runtime.mid, side, held: state.account(address).positions.get(market)?.qty ?? 0n, qty, tiers: runtime.listed.spec.spread_tiers,
    stress: { minSpreadBps: level.min_spread_bps, sizeMultiplierBps: level.size_spread_multiplier_bps }, toxicityBps: 0,
    ceilingBps: metaFor(runtime.listed.spec.symbol).closeCeilingBps, conversion: USD,
  });
}

/** The profit fee rate a close of `holding` pays at `now`, as the engine's `close_fee_terms` reads it; the base with nothing held. */
export function closeFeeBps(state: MockState, holding: Holding | undefined, now: number): number {
  const { profitFeeBps, profitFeeCurve } = state.params;
  return holding === undefined ? profitFeeBps : feeAt(profitFeeBps, profitFeeCurve, now - holding.openedAt);
}

/**
 * Applies a signed fill to a holding and returns the realised profit and loss before the fee, rounded
 * as the engine rounds them from V5 (`Position::apply`): an averaged entry against the holder, up for a
 * long and down for a short, and realised profit and loss down.
 */
function applyToHolding(held: Holding, delta: Fixed, price: Fixed): Fixed {
  if (held.qty === 0n || (held.qty > 0n) === (delta > 0n)) {
    const next = held.qty + delta;
    held.entry += roundDiv((price - held.entry) * absFixed(delta), absFixed(next), next > 0n ? "up" : "down");
    held.qty = next;
    return 0n;
  }
  const closing = absFixed(delta) < absFixed(held.qty) ? absFixed(delta) : absFixed(held.qty);
  const pnl = mulRounded(held.qty > 0n ? price - held.entry : held.entry - price, closing, "down");
  held.qty += delta;
  if (held.qty !== 0n && (held.qty > 0n) === (delta > 0n)) held.entry = price;
  return pnl;
}

/**
 * Checks an order against the market, the quote, the account's margin, and the house's cap; then
 * fills it, charging a realised gain the fee at the closed slice's hold and moving the position's open
 * time as the engine's hold clock does. Every refusal is a typed `Reject`, as the engine logs it.
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
  const priced = liveQuote(state, req.address, req.market, req.side, req.qty);
  if (!priced) return { ok: false, reject: { kind: "no_price" } };
  if (priced.kind === "refused") return { ok: false, reject: priced.reject };
  const before = account.positions.get(req.market);
  const held = before?.qty ?? 0n;
  const delta = signed(req.side, req.qty);
  const feeBps = closeFeeBps(state, before, state.now);
  if (req.slippage) {
    const cap = Math.min(req.slippage.maxBps, runtime.listed.spec.max_slippage_bps);
    const bps = adverseBps(req.side, req.slippage.quoted, priced.price);
    if (exceedsSlippage(req.side, req.slippage.quoted, priced.price, cap)) {
      const reject: Reject = { kind: "slippage", quoted: fixedToWire(req.slippage.quoted), live: fixedToWire(priced.price), slippage_bps: bps };
      return { ok: false, reject };
    }
  }
  if (!req.liquidation && priced.increases) {
    // The account as the fill leaves it: the spread just paid, and the fee on a profit a reversal realises.
    const spreadLoss = executionCost({ held, entry: before?.entry ?? null, delta, price: priced.price, index: runtime.mid, feeBps });
    const refusal = riskRefusal(state, req, runtime.reduceOnly || state.governance.reduceOnlyAt(req.market, state.now), delta, held, spreadLoss);
    if (refusal) return { ok: false, reject: refusal };
  }
  const holding = before ?? { qty: 0n, entry: 0n, openedAt: state.now };
  const pnl = applyToHolding(holding, delta, priced.price);
  const openedAt = openedAfter(held, before?.openedAt ?? null, holding.qty, state.now, lastHold(state.params.profitFeeCurve));
  if (openedAt === null) account.positions.delete(req.market);
  else account.positions.set(req.market, { ...holding, openedAt });
  const fee = profitFee(pnl, feeBps);
  account.balance += pnl - fee;
  state.houseCash += fee - pnl;
  // As the engine does, a loss beyond the balance is written off against the house only once the account is flat.
  let badDebt = 0n;
  if (account.balance < 0n && account.positions.size === 0) {
    badDebt = -account.balance;
    state.houseCash -= badDebt;
    account.balance = 0n;
  }
  // The fill's realised result (a loss adds weight, a profit none) and any write-off feed the account's
  // weight in the open emission period, as the engine records them (`record_period_result`, emissions.rs).
  recordEmissionResult(state, req.address, pnl, badDebt);
  // A fill that closes some of the position names the hold of the slice it closes and the rate it paid (`closed_terms`).
  const closedHold = before !== undefined && (held > 0n) !== (delta > 0n) ? state.now - before.openedAt : null;
  return {
    ok: true,
    badDebt,
    fill: {
      account: req.address, order_id: req.orderId, market: req.market, side: req.side,
      qty: fixedToWire(req.qty), price: fixedToWire(priced.price), index: fixedToWire(runtime.mid),
      // Whole bps of the index, truncated, as the engine's `spread_bps` is; the price less the index is exact.
      spread_bps: Number((priced.spread * 10_000n) / runtime.mid), realised_pnl: fixedToWire(pnl), profit_fee: fixedToWire(fee),
      ...(closedHold === null ? {} : { hold_ms: closedHold, profit_fee_bps: feeBps }),
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
