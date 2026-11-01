"use client";

/** The House page's market caps table: each market's cap as a share of the house's NAV and its dollar floor. */

import { fixedFromWire, formatUsd, type Fixed } from "@/lib/fixed";
import { formatRate } from "@/lib/format";
import { capFor } from "@/lib/house";
import type { MarketModel } from "@/lib/models";

const HEAD = "text-label tracking-caps text-fg-3 uppercase";
const CELL = "text-data text-fg";
const FLOOR_NONE = "None";

/**
 * One row per market: the cap's basis-point share of NAV, its dollar floor, and the cap those give
 * at the signed NAV (`capFor`, the engine's rule). The node's public answers carry no per-market
 * house exposure, so the table shows the caps and the page shows the house's total exposure apart.
 * The market, share, and floor change only when the operator's signed commands change them; the
 * "cap at current NAV" column moves with NAV on every tick and is the one volatile cell.
 */
export function HouseCaps({ markets, nav }: { markets: readonly MarketModel[]; nav: Fixed }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Each market&apos;s house exposure cap: its share of the house&apos;s net asset value, its dollar floor, and the cap those
          give at the current net asset value.
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${HEAD} py-2 pr-4 font-normal`}>Market</th>
            <th scope="col" className={`${HEAD} py-2 pr-4 font-normal`}>Cap, share of NAV</th>
            <th scope="col" className={`${HEAD} py-2 pr-4 font-normal`}>Floor</th>
            <th scope="col" className={`${HEAD} py-2 font-normal`}>Cap at current NAV</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            const floorWire = market.view.house_cap_floor;
            const floor = floorWire === undefined ? 0n : fixedFromWire(floorWire);
            return (
              <tr key={market.id} className="border-b border-line-2">
                <th scope="row" className={`${CELL} py-2 pr-4 font-normal`}>{market.symbol}</th>
                <td className={`${CELL} py-2 pr-4`}>{formatRate(market.view.house_cap_bps)}</td>
                <td className={`${CELL} py-2 pr-4`}>{floorWire === undefined ? FLOOR_NONE : formatUsd(floor)}</td>
                <td className={`${CELL} py-2`}>{formatUsd(capFor(nav, market.view.house_cap_bps, floor))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
