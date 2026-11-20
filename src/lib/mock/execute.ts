/** Fills an order against the house at the live price, or says why it cannot. */

import { absFixed, bpsOf, fixedFromWire, fixedToWire, mulFixed, type Fixed } from "../fixed";
import { metaFor } from "../engine/meta";
import type { EngineEvent, Fill, MarketId, Reject, Side } from "../engine/types";
import { mulRounded, roundDiv } from "../fixed-rounding";
import { feeAt, lastHold, openedAfter, profitFee } from "../holding-fee";
import { feeBaseOf, houseNav, houseNetNotional, marginFloorOf, tierOfAccount } from "./accounts";
import { recordEmissionResult } from "./emissions";
import { adverseBps, exceedsSlippage, notionalOf, priceOrder, USD, type Priced } from "../pricing";
import { accountSpreadTiers } from "../volume-tier";
import { settleLevels, type FillCause } from "./level-state";
import { requirementOf, type Book } from "./portfolio";
import type { AccountState, Holding, MockState } from "./state";
import { recordFill } from "./volume";

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
  /** What the fill is booked as, which names why closing the whole position removes its levels; an order's without it. */
  cause?: FillCause;
  /** A last check on the priced fill before it is booked, as the engine's `execute_checked` runs a market order's levels; its refusal refuses the fill. */
  check?: () => Reject | null;
  /** An ordinary order, whose fill that only reduces is checked when it raises the initial requirement (V84, `Exec::close_checked`); absent for a close-all entry, a triggered order, a level or a close-out. */
  closeChecked?: boolean;
}

/** A filled order, with any loss beyond the balance that the house wrote off because the account is flat, and the levels it removed. */
export type FillOutcome = { ok: true; fill: Fill; badDebt: Fixed; removed: EngineEvent | null } | { ok: false; reject: Reject };

const signed = (side: Side, qty: Fixed): Fixed => (side === "buy" ? qty : -qty);

/**
 * The price `qty` of `market` on `side` pays for the account's current holding, as the engine prices it
 * from V52 (`pricing.ts`): the account's tier's best-price bound, the market's stress level from the mock's
 * parameters, no toxicity add-on (the mock scores none), and its close-spread ceiling. `held` prices it against
 * another holding than the account's own, such as the position a fill would leave. Null for a market the mock does not list.
 */
export function liveQuote(state: MockState, address: string, market: MarketId, side: Side, qty: Fixed, held?: Fixed): Priced | null {
  const account = state.account(address);
  // From V59 the account's first band ends at its tier's share of the market's, so a higher tier trades more size at the best price.
  return quoteAtShare(state, market, side, qty, held ?? account.positions.get(market)?.qty ?? 0n, tierOfAccount(state, account).terms?.bestPriceShareBps);
}

/**
 * The price `qty` of `market` on `side` pays against a holding of `held` at a best-price share of `shareBps` (the listed bands
 * without one), as `liveQuote` prices it. Error cases:
 * - the mock's parameters list no stress level, which they always do
 */
export function quoteAtShare(state: MockState, market: MarketId, side: Side, qty: Fixed, held: Fixed, shareBps: number | undefined): Priced | null {
  const runtime = state.markets.get(market);
  if (!runtime) return null;
  const level = state.params.stressLevels[runtime.stress] ?? state.params.stressLevels[0];
  if (level === undefined) throw new Error("the mock's parameters list no stress level");
  return priceOrder({
    mid: runtime.mid, side, held, qty, tiers: shareBps === undefined ? runtime.listed.spec.spread_tiers : accountSpreadTiers(runtime.listed.spec.spread_tiers, shareBps),
    stress: { minSpreadBps: level.min_spread_bps, sizeMultiplierBps: level.size_spread_multiplier_bps }, toxicityBps: 0,
    ceilingBps: metaFor(runtime.listed.spec.symbol).closeCeilingBps, conversion: USD,
  });
}

/** The profit fee rate a close of `holding` pays `account` at `now`, as the engine's `close_fee_terms` reads it: the base less the account's tier's fee discount, or `base` given, and the curve past it; that base with nothing held. */
export function closeFeeBps(state: MockState, account: AccountState, holding: Holding | undefined, now: number, base: number = feeBaseOf(state, account)): number {
  return holding === undefined ? base : feeAt(base, state.params.profitFeeCurve, now - holding.openedAt);
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

/** A fill that has priced: the request as clamped, its price at the market's index, and the account's holding before it. */
export interface FillPlan {
  req: FillRequest;
  priced: { price: Fixed; spread: Fixed; increases: boolean };
  mid: Fixed;
  before: Holding | undefined;
  held: Fixed;
  delta: Fixed;
  feeBps: number;
}

/** A plan that passed every check; or a refusal of the order or its pricing, with no plan; or a refusal of the plan's risk, margin or house capacity. */
export type CheckedFill = { ok: true; plan: FillPlan } | { ok: false; reject: Reject; plan: FillPlan | null };

/**
 * Checks an order against the market, the quote, the account's margin, and the house's cap, without changing anything. Every
 * refusal is a typed `Reject`, as the engine logs it; a refusal of the account's margin or the house's capacity keeps the plan,
 * as the engine's preview prices the fill it declines.
 */
export function checkFill(state: MockState, order: FillRequest): CheckedFill {
  const runtime = state.markets.get(order.market);
  const heldNow = state.account(order.address).positions.get(order.market)?.qty ?? 0n;
  const refused = (reject: Reject): CheckedFill => ({ ok: false, reject, plan: null });
  // A reduce-only order is clamped to what it can reduce, and refused when it would reduce nothing.
  const reducible = (order.side === "buy") === (heldNow < 0n) ? absFixed(heldNow) : 0n;
  if (order.reduceOnly && !order.liquidation && reducible === 0n) return refused({ kind: "reduce_only" });
  const req = order.reduceOnly && order.qty > reducible ? { ...order, qty: reducible } : order;
  const account = state.account(req.address);
  if (!runtime) return refused({ kind: "unknown_market" });
  if (!runtime.open || runtime.halted) return refused({ kind: "market_closed" });
  const priced = liveQuote(state, req.address, req.market, req.side, req.qty);
  if (!priced) return refused({ kind: "no_price" });
  if (priced.kind === "refused") return refused(priced.reject);
  if (req.slippage) {
    const cap = Math.min(req.slippage.maxBps, runtime.listed.spec.max_slippage_bps);
    const bps = adverseBps(req.side, req.slippage.quoted, priced.price);
    if (exceedsSlippage(req.side, req.slippage.quoted, priced.price, cap)) return refused({ kind: "slippage", quoted: fixedToWire(req.slippage.quoted), live: fixedToWire(priced.price), slippage_bps: bps });
  }
  const before = account.positions.get(req.market);
  const plan: FillPlan = { req, priced, mid: runtime.mid, before, held: before?.qty ?? 0n, delta: signed(req.side, req.qty), feeBps: closeFeeBps(state, account, before, state.now) };
  if (req.liquidation) return { ok: true, plan };
  if (priced.increases) {
    const form = orderableRefusal(state, req, runtime.reduceOnly || state.governance.reduceOnlyAt(req.market, state.now));
    if (form) return refused(form);
  }
  const reject = riskRefusal(state, plan);
  return reject === null ? { ok: true, plan } : { ok: false, reject, plan };
}

/**
 * Checks an order as `checkFill` does, then fills it, charging a realised gain the fee at the closed slice's hold and moving the
 * position's open time as the engine's hold clock does.
 */
export function fillOrder(state: MockState, order: FillRequest): FillOutcome {
  const checked = checkFill(state, order);
  if (!checked.ok) return { ok: false, reject: checked.reject };
  const refused = order.check?.() ?? null;
  return refused === null ? book(state, checked.plan) : { ok: false, reject: refused };
}

/** Books a checked plan's fill: the holding, the volume, the levels it removes, the fee and any write-off. */
function book(state: MockState, plan: FillPlan): FillOutcome {
  const { req, priced, before, held, delta, feeBps } = plan;
  const account = state.account(req.address);
  const holding = before ?? { qty: 0n, entry: 0n, openedAt: state.now };
  const pnl = applyToHolding(holding, delta, priced.price);
  recordFill(account.volume, { market: req.market, held, delta, price: priced.price, now: state.now, liquidation: req.liquidation ?? false });
  const openedAt = openedAfter(held, before?.openedAt ?? null, holding.qty, state.now, lastHold(state.params.profitFeeCurve));
  if (openedAt === null) account.positions.delete(req.market);
  else account.positions.set(req.market, { ...holding, openedAt });
  const removed = settleLevels(account, req.address, req.market, held, holding.qty, req.cause ?? "order");
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
    removed,
    fill: {
      account: req.address, order_id: req.orderId, market: req.market, side: req.side,
      qty: fixedToWire(req.qty), price: fixedToWire(priced.price), index: fixedToWire(plan.mid),
      // Whole bps of the index, truncated, as the engine's `spread_bps` is; the price less the index is exact.
      spread_bps: Number((priced.spread * 10_000n) / plan.mid), realised_pnl: fixedToWire(pnl), profit_fee: fixedToWire(fee),
      ...(closedHold === null ? {} : { hold_ms: closedHold, profit_fee_bps: feeBps }),
      position: fixedToWire(holding.qty), liquidation: req.liquidation ?? false,
    },
  };
}

/** The account's cash and positions as a plan's fill would leave them, its realised result less the fee booked (`account_after`). */
export function bookAfter(state: MockState, plan: FillPlan): Book {
  const account = state.account(plan.req.address);
  const positions = new Map(account.positions);
  const holding = { ...(plan.before ?? { qty: 0n, entry: 0n, openedAt: state.now }) };
  const pnl = applyToHolding(holding, plan.delta, plan.priced.price);
  if (holding.qty === 0n) positions.delete(plan.req.market);
  else positions.set(plan.req.market, holding);
  return { balance: account.balance + pnl - profitFee(pnl, plan.feeBps), positions };
}

/** The refusal of an order that adds risk in a reduce-only market or below the minimum order, or `null`. */
function orderableRefusal(state: MockState, req: FillRequest, reduceOnly: boolean): Reject | null {
  const runtime = state.markets.get(req.market);
  if (!runtime) return { kind: "unknown_market" };
  if (reduceOnly || req.reduceOnly) return { kind: "reduce_only" };
  const spec = runtime.listed.spec;
  if (notionalOf(req.qty, runtime.mid) < fixedFromWire(spec.min_order_notional)) return { kind: "invalid_order", reason: `below the minimum order of ${spec.min_order_notional} USD` };
  return null;
}

/**
 * The refusal of a fill's margin or the house's capacity, or `null` (`check_risk`, `check_close`): a fill that adds risk must leave
 * equity at the initial requirement after it, at the tier floor less each group's credit (V64, V84), and the house within its cap;
 * from V84 an ordinary order whose fill only reduces is held to it too when it raises that requirement, judged with every group's
 * credit kept, as closing one leg of a hedge can. Close-alls, triggered orders, levels and close-outs never are (`close_checked`).
 */
function riskRefusal(state: MockState, plan: FillPlan): Reject | null {
  const { req, priced, delta } = plan;
  const account = state.account(req.address);
  const floorBps = marginFloorOf(state, account);
  const after = bookAfter(state, plan);
  // The check runs on the account as the fill leaves it (`account_after`), valued as the preview gives it: its averaged entry, its
  // realised result less the fee, and each position's profit or loss at the index rounded down.
  const { equity } = requirementOf(state, after, { kind: "market" });
  const initial = (book: Book, shutCredited: boolean) => requirementOf(state, book, { kind: "initial", floorBps, shutCredited }).requirement;
  if (!priced.increases) {
    if (req.closeChecked !== true || initial(after, true) <= initial(account, true)) return null;
    const required = initial(after, false);
    return equity < required ? { kind: "insufficient_margin", equity: fixedToWire(equity), required: fixedToWire(required) } : null;
  }
  const required = initial(after, false);
  if (equity < required) return { kind: "insufficient_margin", equity: fixedToWire(equity), required: fixedToWire(required) };
  const spec = state.markets.get(req.market)?.listed.spec;
  const net = houseNetNotional(state, req.market);
  const netAfter = net - mulFixed(delta, plan.mid);
  const cap = spec === undefined ? 0n : bpsOf(houseNav(state), spec.house_cap_bps);
  if (absFixed(netAfter) > absFixed(net) && absFixed(netAfter) > cap) return { kind: "house_capacity" };
  return null;
}

/** The events a fill produces, in the engine's order: the fill, the levels it removed, and any write-off. */
export function fillEvents({ fill, badDebt, removed }: { fill: Fill; badDebt: Fixed; removed: EngineEvent | null }): EngineEvent[] {
  const events: EngineEvent[] = [{ type: "fill", ...fill }];
  if (removed !== null) events.push(removed);
  if (badDebt > 0n) events.push({ type: "bad_debt", account: fill.account, amount: fixedToWire(badDebt) });
  return events;
}
