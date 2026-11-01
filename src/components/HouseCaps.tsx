"use client";

/** The House page's market caps: each market's cap as a share of the house's NAV and its dollar floor — a table from 640 px, stacked below it. */

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
 * "cap at current NAV" moves with NAV on every tick. Below 640 px the same figures stack so nothing
 * scrolls sideways at 320 px; exactly one rendering shows at any width.
 */
export function HouseCaps({ markets, nav }: { markets: readonly MarketModel[]; nav: Fixed }) {
  const row = (market: MarketModel) => {
    const floorWire = market.view.house_cap_floor;
    const floor = floorWire === undefined ? 0n : fixedFromWire(floorWire);
    return {
      symbol: market.symbol,
      share: formatRate(market.view.house_cap_bps),
      floor: floorWire === undefined ? FLOOR_NONE : formatUsd(floor),
      cap: formatUsd(capFor(nav, market.view.house_cap_bps, floor)),
    };
  };
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
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
              const r = row(market);
              return (
                <tr key={market.id} className="border-b border-line-2">
                  <th scope="row" className={`${CELL} py-2 pr-4 font-normal`}>{r.symbol}</th>
                  <td className={`${CELL} py-2 pr-4`}>{r.share}</td>
                  <td className={`${CELL} py-2 pr-4`}>{r.floor}</td>
                  <td className={`${CELL} py-2`}>{r.cap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sm:hidden">
        <p className="sr-only">Each market&apos;s house exposure cap: its share of the house&apos;s net asset value, its dollar floor, and the cap those give at the current net asset value.</p>
        <dl className="space-y-3">
          {markets.map((market) => {
          const r = row(market);
          return (
            <div key={market.id} className="space-y-1 border-b border-line-2 pb-3">
              <dt className={`${HEAD} font-normal`}>{r.symbol}</dt>
              <dd className={CELL}>Cap, share of NAV: {r.share}</dd>
              <dd className={CELL}>Floor: {r.floor}</dd>
              <dd className={CELL}>Cap at current NAV: {r.cap}</dd>
            </div>
          );
          })}
        </dl>
      </div>
    </>
  );
}
