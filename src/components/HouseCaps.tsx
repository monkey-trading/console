"use client";

/** The House page's market caps: each market's cap as a share of the house's NAV and its dollar floor, and how much of it the house's net exposure uses — a table from 640 px, stacked below it. */

import { absFixed, fixedFromWire, formatUsd, type Fixed } from "@/lib/fixed";
import { formatRate } from "@/lib/format";
import { capFor, utilBps } from "@/lib/house";

import { Term } from "./house/Panel";

const HEAD = "text-label tracking-caps text-fg-3 uppercase";
const CELL = "text-caption tabular-nums text-fg";
const FLOOR_NONE = "None";

/** What each column means, shared by the table's heads and the stacked labels so the two cannot drift. */
const TIPS = {
  share: "The percentage of the house value that sets the market's exposure limit.",
  floor: "The lowest that the market's exposure limit can be, in US dollars, regardless of the house value.",
  cap: "The maximum net exposure the house will take in the market, which is its percentage of the house value or its dollar minimum, whichever is higher.",
  exposure: "The house's net exposure in the market as at the most recent update, calculated as traders' long positions minus their short positions.",
  used: "The house's net exposure as a percentage of the market's exposure limit.",
} as const;

/** One market's cap terms and, from the node's scan, the house's net exposure in it. */
export interface CapRow {
  id: number;
  symbol: string;
  /** The cap's share of NAV, in basis points. */
  bps: number;
  /** The cap's dollar floor, as the wire writes it; absent when the market has none. */
  floor: string | undefined;
  /** The house's net notional in the market (clients' net, which the house holds the opposite of); null before a scan. */
  net: Fixed | null;
}

/**
 * One row per market: the cap's basis-point share of NAV, its dollar floor, the cap those give at
 * the signed NAV (`capFor`, the engine's rule), and the exposure the node's last scan puts against
 * it. The market, share, and floor change only when the operator's signed commands change them;
 * the cap moves with NAV. Below 640 px the same figures stack so nothing scrolls sideways at
 * 320 px; exactly one rendering shows at any width.
 */
export function HouseCaps({ rows, nav }: { rows: readonly CapRow[]; nav: Fixed }) {
  const figures = rows.map((row) => {
    const floor = row.floor === undefined ? 0n : fixedFromWire(row.floor);
    const cap = capFor(nav, row.bps, floor);
    const used = row.net === null ? null : utilBps(absFixed(row.net), cap);
    return { id: row.id, symbol: row.symbol, share: formatRate(row.bps), floor: row.floor === undefined ? FLOOR_NONE : formatUsd(floor), cap: formatUsd(cap), exposure: row.net === null ? "—" : formatUsd(absFixed(row.net)), used: used === null ? "—" : formatRate(used) };
  });
  const caption = "Each market's exposure limit, showing its percentage of the house value, its dollar minimum, the resulting limit at the current house value and the house's net exposure against that limit.";
  return (
    <>
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${HEAD} py-1 pr-3 font-normal`}>Market</th>
              <th scope="col" className={`${HEAD} py-1 pr-3 text-right font-normal`}><Term label="Share of house value" tip={TIPS.share} /></th>
              <th scope="col" className={`${HEAD} py-1 pr-3 text-right font-normal`}><Term label="Minimum" tip={TIPS.floor} /></th>
              <th scope="col" className={`${HEAD} py-1 pr-3 text-right font-normal`}><Term label="Limit" tip={TIPS.cap} /></th>
              <th scope="col" className={`${HEAD} py-1 pr-3 text-right font-normal`}><Term label="Net exposure" tip={TIPS.exposure} /></th>
              <th scope="col" className={`${HEAD} py-1 text-right font-normal`}><Term label="Used" tip={TIPS.used} /></th>
            </tr>
          </thead>
          <tbody>
            {figures.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <th scope="row" className={`${CELL} py-1 pr-3 font-normal`}>{r.symbol}</th>
                <td className={`${CELL} py-1 pr-3 text-right`}>{r.share}</td>
                <td className={`${CELL} py-1 pr-3 text-right`}>{r.floor}</td>
                <td className={`${CELL} py-1 pr-3 text-right`}>{r.cap}</td>
                <td className={`${CELL} py-1 pr-3 text-right`}>{r.exposure}</td>
                <td className={`${CELL} py-1 text-right`}>{r.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sm:hidden">
        <p className="sr-only">{caption}</p>
        <dl className="space-y-2">
          {figures.map((r) => (
            <div key={r.id} className="space-y-0.5 border-b border-line pb-2">
              <dt className={`${HEAD} font-normal`}>{r.symbol}</dt>
              <dd className={CELL}><Term label="Share of house value" tip={TIPS.share} />: {r.share}</dd>
              <dd className={CELL}><Term label="Minimum" tip={TIPS.floor} />: {r.floor}</dd>
              <dd className={CELL}><Term label="Limit" tip={TIPS.cap} />: {r.cap}</dd>
              <dd className={CELL}><Term label="Net exposure" tip={TIPS.exposure} />: {r.exposure} (<Term label="used" tip={TIPS.used} />: {r.used})</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
