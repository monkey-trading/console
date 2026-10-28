/** The console's decoded view models: engine wire shapes with amounts parsed into `Fixed`. */

import { metaFor } from "./engine/meta";
import type { AccountView, EligibilityClass, HouseView, MarketId, MarketView, RestingOrder } from "./engine/types";
import { fixedFromWire, type Fixed } from "./fixed";

export interface MarketModel {
  view: MarketView;
  id: MarketId;
  symbol: string;
  name: string;
  places: number;
  baseSpreadBps: number;
  open: boolean;
  reduceOnly: boolean;
  stress: number;
  /** The latest index mark, or null before the first. */
  mark: Fixed | null;
  /** The first mark this session, for the change shown beside the price. */
  reference: Fixed | null;
}

export function decodeMarket(view: MarketView, previous: MarketModel | undefined): MarketModel {
  const meta = metaFor(view.symbol);
  const mark = view.mark === null ? null : fixedFromWire(view.mark);
  return {
    view, id: view.id, symbol: view.symbol, name: meta.name, places: meta.places, baseSpreadBps: meta.baseSpreadBps,
    open: view.open, reduceOnly: view.reduce_only, stress: view.stress_level, mark,
    reference: previous?.reference ?? mark,
  };
}

export interface PositionModel {
  market: MarketId;
  qty: Fixed;
  entry: Fixed;
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
    positions: Object.entries(view.positions).map(([id, p]) => ({ market: Number(id), qty: fixedFromWire(p.qty), entry: fixedFromWire(p.entry) })),
    orders: Object.values(view.orders),
  };
}

export interface HouseModel {
  cash: Fixed;
  nav: Fixed;
  grossExposure: Fixed;
}

export function decodeHouse(view: HouseView): HouseModel {
  return { cash: fixedFromWire(view.cash), nav: fixedFromWire(view.nav), grossExposure: fixedFromWire(view.gross_exposure) };
}

export type Eligibility = EligibilityClass | null;
