"use client";

/** The account's volume tier: counted and pending volume, the step to the next tier, and what this tier and the next bring in the selected market. */

import { useId } from "react";

import { formatUsd } from "@/lib/fixed";
import { currentParams } from "@/lib/ticket-figures";
import { describeBestPrice, describeLimit, describeNextTier, tierBenefits, tierStanding } from "@/lib/tier-view";
import { formatLeverage } from "@/lib/volume-tier";

import { useConsole } from "./ConsoleProvider";

const CELL = "px-2 py-2 text-left align-top text-data sm:px-3";

/** The volume tier card on the Funding page; absent from a node that predates volume tiers. */
export function VolumeTierCard() {
  const state = useConsole();
  const heading = useId();
  const standing = tierStanding(state.account, currentParams(state));
  if (standing === null) return null;
  const market = state.markets.find((m) => m.id === state.selected);
  const benefits = tierBenefits(standing, market?.view);
  const { volume, next } = standing;
  const toxicity = state.account?.toxicity;
  const nextTier = standing.table?.[standing.tier + 1] === undefined ? null : standing.tier + 1;
  return (
    <section aria-labelledby={heading} className="rounded-xl border border-line-2 bg-ink-1 px-4 py-3">
      <h3 id={heading} className="text-label tracking-caps text-fg-3 uppercase">Volume tier</h3>
      <p className="mt-2 text-lead text-fg">Tier {standing.tier}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-caption sm:grid-cols-3">
        <div><dt className="text-fg-3">Counted volume, last 30 days</dt><dd className="mt-0.5 text-data text-fg">{formatUsd(volume.matured)}</dd></div>
        <div><dt className="text-fg-3">Pending</dt><dd className="mt-0.5 text-data text-fg">{formatUsd(volume.pending)}</dd></div>
        {toxicity !== undefined && toxicity.tier > 0 && <div className="col-span-2 sm:col-span-1"><dt className="text-fg-3">Toxicity add-on</dt><dd className="mt-0.5 text-data text-fg">+{toxicity.addOnBps} {toxicity.addOnBps === 1 ? "bp" : "bps"} on every price</dd></div>}
      </dl>
      <p className="mt-2 text-label leading-relaxed text-fg-3">Opening volume counts once the position has been held for a minute; a position closed sooner counts nothing. Only counted volume reaches a tier.</p>
      {standing.table === null && <p className="mt-3 text-label text-fg-3">What each tier needs and brings shows once the node's parameters are read.</p>}
      {next !== null && <p className="mt-3 text-caption text-fg-2">{describeNextTier(next)}</p>}
      {standing.table !== null && next === null && <p className="mt-3 text-caption text-fg-2">This is the highest tier.</p>}
      {benefits !== null && (
        <div className="mt-3">
          <table className="w-full border-collapse text-caption">
            <caption className="pb-1 text-left text-label text-fg-3">What each tier brings{market === undefined ? "" : ` in ${market.symbol}`}</caption>
            <thead>
              <tr className="border-b border-line text-fg-3">
                <th scope="col" className={`${CELL} font-normal`}><span className="sr-only">Benefit</span></th>
                <th scope="col" className={`${CELL} font-normal`}>Tier {standing.tier} (yours)</th>
                {benefits.next !== null && nextTier !== null && <th scope="col" className={`${CELL} font-normal`}>Tier {nextTier}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Row label="Best-price size" now={describeBestPrice(benefits.now.bestPriceBound)} next={benefits.next && describeBestPrice(benefits.next.bestPriceBound)} />
              <Row label="Leverage" now={benefits.now.leverage === null ? "—" : `Up to ${formatLeverage(benefits.now.leverage)}`} next={benefits.next && (benefits.next.leverage === null ? "—" : `Up to ${formatLeverage(benefits.next.leverage)}`)} />
              <Row label="Resting orders" now={describeLimit(benefits.now.maxRestingOrders)} next={benefits.next && describeLimit(benefits.next.maxRestingOrders)} />
              <Row label="Requests a second" now={describeLimit(benefits.now.requestsPerSecond)} next={benefits.next && describeLimit(benefits.next.requestsPerSecond)} />
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ label, now, next }: { label: string; now: string; next: string | null }) {
  return (
    <tr>
      <th scope="row" className={`${CELL} font-normal text-fg-2`}>{label}</th>
      <td className={`${CELL} text-fg`}>{now}</td>
      {next !== null && <td className={`${CELL} text-fg`}>{next}</td>}
    </tr>
  );
}
