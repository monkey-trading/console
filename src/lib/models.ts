/** The console's decoded view models: engine wire shapes with amounts parsed into `Fixed`. */

import { metaFor } from "./engine/meta";
import type { AccountView, CloseFee, EligibilityClass, HouseView, MarketId, MarketView, PriceRules, RestingOrder } from "./engine/types";
import { fixedFromWire, parseFixed, type Fixed } from "./fixed";
import { decodeHouseScan, type HouseScan } from "./house-scan";
import { decodeVolume, type VolumeModel } from "./volume-tier";

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
  /** From V64, what fills and withdrawals must leave equity above, and what the account may withdraw; absent from a node that predates it, and from the mock before its first read. */
  requirements?: Requirements;
  /** From V59, the volume tier and its progress; absent from a node that predates it. */
  volume?: VolumeModel;
  /** From V54, the toxicity tier that applies and the spread it adds, in bps; absent from a node that predates it. */
  toxicity?: ToxicityModel;
}

/** The margin standing of the account read: the initial requirement (at the tier's margin floor), the maintenance requirement a close-out reads, the withdrawable cash and each market's maximum leverage. */
export interface Requirements {
  initialMargin: Fixed;
  maintenanceMargin: Fixed;
  withdrawable: Fixed;
  maxLeverage: ReadonlyMap<MarketId, Fixed>;
}

/** An account's toxicity as its read gives it: the tier that applies (counted from 1, 0 for none) and the spread it adds to every price, in bps. */
export interface ToxicityModel {
  tier: number;
  addOnBps: number;
}

/** The V64 margin standing the read gave, or undefined when the node predates it or a figure is malformed. */
function decodeRequirements(view: AccountView): Requirements | undefined {
  const initial = parseFixed(view.initial_margin ?? "");
  const maintenance = parseFixed(view.maintenance_margin ?? "");
  const withdrawable = parseFixed(view.withdrawable ?? "");
  if (initial === null || maintenance === null || withdrawable === null) return undefined;
  const maxLeverage = new Map<MarketId, Fixed>();
  for (const [market, value] of Object.entries(view.max_leverage ?? {})) {
    const leverage = parseFixed(value);
    if (leverage === null || !Number.isSafeInteger(Number(market))) return undefined;
    maxLeverage.set(Number(market), leverage);
  }
  return { initialMargin: initial, maintenanceMargin: maintenance, withdrawable, maxLeverage };
}

function decodeToxicity(view: AccountView): ToxicityModel | undefined {
  const found = view.toxicity;
  return found !== undefined && Number.isSafeInteger(found.tier) && Number.isSafeInteger(found.add_on_bps) ? { tier: found.tier, addOnBps: found.add_on_bps } : undefined;
}

export function decodeAccount(view: AccountView): AccountModel {
  return {
    balance: fixedFromWire(view.balance),
    unfinalised: fixedFromWire(view.unfinalised_deposits ?? "0"),
    equity: fixedFromWire(view.equity),
    margin: fixedFromWire(view.margin),
    positions: Object.entries(view.positions).map(([id, p]) => ({ market: Number(id), qty: fixedFromWire(p.qty), entry: fixedFromWire(p.entry), closeout: decodeCloseout(view, Number(id)), closeFee: decodeCloseFee(view, Number(id)) })),
    orders: Object.values(view.orders),
    ...optional("requirements", decodeRequirements(view)),
    ...optional("volume", decodeVolume(view.volume) ?? undefined),
    ...optional("toxicity", decodeToxicity(view)),
  };
}

/** `{ key: value }`, or nothing for an absent value, so a model from a node that predates a field has no key for it. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
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
