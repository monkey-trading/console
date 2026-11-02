/** The figures `/v1/house` adds from the node's scan of every account, decoded; null where the node has not scanned yet. */

import type { HouseScanView } from "./engine/stats-types";
import type { MarketId } from "./engine/types";
import { fixedFromWire, type Fixed } from "./fixed";

/** One market's clients' notional and the house's result in it. */
export interface HouseMarketScan {
  market: MarketId;
  symbol: string;
  mark: Fixed | null;
  long: Fixed | null;
  short: Fixed | null;
  net: Fixed | null;
  longPositions: number | null;
  shortPositions: number | null;
  unrealised: Fixed;
  volume: Fixed;
}

export interface HouseScan {
  /** The sequenced time of the scan the open figures are from; null before the first. */
  snapshotMs: number | null;
  openInterest: Fixed | null;
  openMargin: Fixed | null;
  openPositions: number | null;
  /** The house's result at the marks: NAV less cash. */
  unrealised: Fixed;
  volume: Fixed;
  volumeSinceMs: number;
  markets: readonly HouseMarketScan[];
}

const optional = (text: string | null | undefined): Fixed | null => (text === null || text === undefined ? null : fixedFromWire(text));

/** The scan figures of a `/v1/house` answer, or null from a node that predates them. */
export function decodeHouseScan(view: HouseScanView): HouseScan | null {
  if (view.markets === undefined || view.unrealised === undefined || view.volume === undefined || view.volume_since_ms === undefined) return null;
  return {
    snapshotMs: view.snapshot_ms ?? null,
    openInterest: optional(view.open_interest),
    openMargin: optional(view.open_margin),
    openPositions: view.open_positions ?? null,
    unrealised: fixedFromWire(view.unrealised),
    volume: fixedFromWire(view.volume),
    volumeSinceMs: view.volume_since_ms,
    markets: view.markets.map((m) => ({
      market: m.market,
      symbol: m.symbol,
      mark: optional(m.mark),
      long: optional(m.long),
      short: optional(m.short),
      net: optional(m.net),
      longPositions: m.long_positions,
      shortPositions: m.short_positions,
      unrealised: fixedFromWire(m.unrealised),
      volume: fixedFromWire(m.volume),
    })),
  };
}
