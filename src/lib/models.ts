/** The console's decoded view models: engine wire shapes with amounts parsed into `Fixed`. */

import { metaFor } from "./engine/meta";
import type { AccountView, CloseFee, EligibilityClass, HouseView, MarketId, MarketView, PriceRules, RestingOrder } from "./engine/types";
import { fixedFromWire, parseFixed, type Fixed } from "./fixed";
import { decodeHouseScan, type HouseScan } from "./house-scan";

export interface MarketModel {
  view: MarketView;
  id: MarketId;
  symbol: string;
  name: string;
  places: number;
  /** The mock's close-spread ceiling, which its own prices clamp a close to; null for a live node, which serves none and prices from its quotes. */
  ceilingBps: number | null;
  /** The market's index rules, for the chart's log scan; what the engine prices from. */
  priceRules: PriceRules;
  open: boolean;
  reduceOnly: boolean;
  stress: number;
  /** The latest index mark, or null before the first. */
  mark: Fixed | null;
  /** The first mark this session, for the change shown beside the price. */
  reference: Fixed | null;
}

/** `simulated` keeps the mock's close-spread ceiling, which the console's own prices for the mock clamp to. */
export function decodeMarket(view: MarketView, previous: MarketModel | undefined, simulated: boolean): MarketModel {
  const meta = metaFor(view.symbol);
  const mark = view.mark === null ? null : fixedFromWire(view.mark);
  return {
    view, id: view.id, symbol: view.symbol, name: meta.name, places: meta.places, ceilingBps: simulated ? meta.closeCeilingBps : null,
    priceRules: view.price_rules,
    open: view.open, reduceOnly: view.reduce_only, stress: view.stress_level, mark,
    reference: previous?.reference ?? mark,
  };
}

/** Where a position's account closes out: already, at a price, or at none inside the node's range. */
export type CloseoutModel = { reach: "due" } | { reach: "at"; price: Fixed } | { reach: "beyond" };

export interface PositionModel {
  market: MarketId;
  qty: Fixed;
  entry: Fixed;
  /** Null from a node that does not serve close-outs, or whose entry for the market is malformed. */
  closeout: CloseoutModel | null;
  /** From V55, when the position opened and what a close of it paid at the read; null before V55 or from a node that does not serve it. */
  closeFee: CloseFeeModel | null;
}

/** A position's close fee as the account read gave it: its open time, the rate a gain paid then, and when that rate next fell. */
export interface CloseFeeModel {
  openedAt: number;
  feeBps: number;
  fallsAt: number | null;
}

/** The close fee the node gave for `market`, if it gave a well-formed one. */
function decodeCloseFee(view: AccountView, market: MarketId): CloseFeeModel | null {
  const found: CloseFee | undefined = view.close_fees?.[String(market)];
  if (found === undefined || !Number.isSafeInteger(found.opened_at) || !Number.isSafeInteger(found.fee_bps)) return null;
  return { openedAt: found.opened_at, feeBps: found.fee_bps, fallsAt: Number.isSafeInteger(found.falls_at) ? found.falls_at : null };
}

/** The close-out the node gave for `market`, if it gave a well-formed one. */
function decodeCloseout(view: AccountView, market: MarketId): CloseoutModel | null {
  const found = view.closeouts?.find((c) => c.market === market);
  if (found === undefined) return null;
  if (found.reach === "due" || found.reach === "beyond") return { reach: found.reach };
  if (found.reach !== "at" || typeof found.price !== "string") return null;
  const price = parseFixed(found.price);
  return price === null ? null : { reach: "at", price };
}

export interface AccountModel {
  balance: Fixed;
  unfinalised: Fixed;
  equity: Fixed;
  margin: Fixed;
  positions: PositionModel[];
  orders: RestingOrder[];
}

export function decodeAccount(view: AccountView): AccountModel {
  return {
    balance: fixedFromWire(view.balance),
    unfinalised: fixedFromWire(view.unfinalised_deposits ?? "0"),
    equity: fixedFromWire(view.equity),
    margin: fixedFromWire(view.margin),
    positions: Object.entries(view.positions).map(([id, p]) => ({ market: Number(id), qty: fixedFromWire(p.qty), entry: fixedFromWire(p.entry), closeout: decodeCloseout(view, Number(id)), closeFee: decodeCloseFee(view, Number(id)) })),
    orders: Object.values(view.orders),
  };
}

export interface HouseModel {
  cash: Fixed;
  nav: Fixed;
  grossExposure: Fixed;
  /** The node's scan figures; null from a node that predates them. */
  scan: HouseScan | null;
}

export function decodeHouse(view: HouseView): HouseModel {
  return { cash: fixedFromWire(view.cash), nav: fixedFromWire(view.nav), grossExposure: fixedFromWire(view.gross_exposure), scan: decodeHouseScan(view) };
}

export type Eligibility = EligibilityClass | null;
