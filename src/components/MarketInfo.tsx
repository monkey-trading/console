/** The ticket's "Market info" section: hours, stress, the spread bands and any pending listing change, margin, price terms, the take-profit and stop-loss distance and the house's room. */

import type { ListingNotice, Side, SpreadTier, StressLevel } from "@/lib/engine/types";
import { spokenRate } from "@/lib/fee-words";
import { minLevelDistance } from "@/lib/levels";
import { bpsOf, formatUsd, type Fixed } from "@/lib/fixed";
import { formatMovePercent } from "@/lib/format";
import type { MarketModel } from "@/lib/models";
import { formatMark } from "@/lib/price-format";
import { describeSchedule } from "@/lib/schedule";
import { bandRows, describeNotice, formatMultiplier, spreadRate } from "@/lib/spread-bands";
import { STRESS_NAMES, STRESS_TONE } from "@/lib/stress";
import type { TicketPreview } from "@/lib/ticket";


const usd = formatUsd;
const ROW = "flex justify-between gap-3";

/** A bar filled to `bps` of its width, from 0 to 10,000. */
function UseBar({ bps }: { bps: number }) {
  const tone = bps > 9_000 ? "bg-ember" : bps > 6_000 ? "bg-amber" : "bg-glow";
  return (
    <div aria-hidden="true" className="mt-2 h-1.5 rounded-sm bg-line-2">
      <div className={`h-full rounded-sm ${tone}`} style={{ width: `${Math.min(Math.max(bps, 0), 10_000) / 100}%` }} />
    </div>
  );
}

/** When positions are closed out, at the close-out level the trading terms set, or in words while they are not read. */
export function describeCloseout(closeoutBps: number | null): string {
  if (closeoutBps === null) return "If your equity falls below the close-out level, which is a share of your margin requirement, your positions are closed out.";
  return `If your equity falls below ${spokenRate(closeoutBps)} of your margin requirement, your positions are closed out.`;
}

/** What the market's minimum distance for take-profit and stop-loss levels means. */
export function describeLevelDistance(bps: number): string {
  return `A take profit or stop loss must be set at least ${spokenRate(bps)} away from the price at which the position would close, on the correct side of it. For a limit or stop order, the distance is measured from the order's trigger price.`;
}

/** What the market's stress level adds now: the size spread's multiplier and the spread it adds to every fill. */
function stressTerms(level: StressLevel): string {
  const minimum = level.min_spread_bps > 0 ? `, plus ${level.min_spread_bps} ${level.min_spread_bps === 1 ? "bp" : "bps"} on every trade` : "";
  return `Spreads ×${formatMultiplier(level.size_spread_multiplier_bps)}${minimum}`;
}

/**
 * `price` is the price a market order on `side` would be sent at, with the worst price `slippageBps`
 * allows; null shows neither. `stress` is the market's level's terms from the node's parameters, and
 * `notice` its pending listing notice, and `closeoutBps` the close-out level; null when the node has given none or they are not current.
 * `paramsNote` says why they are missing: a read failed, the node serves none, or a change is unread.
 */
export function MarketInfo({ market, spreadTiers, ownBands, preview, side, price, slippageBps, stress, closeoutBps, notice, paramsNote }: { market: MarketModel; spreadTiers: readonly SpreadTier[]; ownBands: boolean; preview: TicketPreview; side: Side; price: Fixed | null; slippageBps: number; stress: StressLevel | null; closeoutBps: number | null; notice: ListingNotice | null; paramsNote: string | null }) {
  const worst = price === null ? null : side === "buy" ? price + bpsOf(price, slippageBps) : price - bpsOf(price, slippageBps);
  const useBps = preview.marginUseBps;
  const filled = preview.houseCap > 0n ? Math.min(8, Math.ceil(Number((preview.markNotional * 8n) / preview.houseCap) || 0)) : 0;
  const capShare = preview.houseCap > 0n ? Number((preview.markNotional * 100n) / preview.houseCap) : 0;
  const stressName = STRESS_NAMES[market.stress] ?? "Normal";
  const bands = bandRows(spreadTiers, spreadRate);
  const changes = notice === null ? [] : describeNotice(notice);
  const levelDistance = minLevelDistance(market.view);
  return (
    <details className="group border-t border-line">
      <summary className="flex items-center justify-between px-4 py-4 text-label tracking-caps text-fg-3 uppercase hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-glow sm:px-5">
        Market info <span aria-hidden="true" className="group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-5 px-4 pb-5 text-caption sm:px-5">
        <dl className="space-y-3">
          <div className={ROW}><dt className="text-fg-3">Market hours</dt><dd className={market.open ? "text-glow" : "text-ember"}>{market.open ? "Open" : "Closed"} · {describeSchedule(market.view.schedule)}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Stress level</dt><dd className={`text-right ${STRESS_TONE[market.stress] ?? ""}`}>{market.stress} · {stressName}{stress !== null ? <span className="block text-fg-3">{stressTerms(stress)}</span> : paramsNote !== null && <span className="block text-fg-3">{paramsNote}</span>}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Margin rate</dt><dd>{preview.marginRateBps === null ? "—" : `${formatMovePercent(preview.marginRateBps).replace("+", "")} of the new position`}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Required margin</dt><dd>{usd(preview.marginAdded)}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Leverage</dt><dd>{preview.impliedLeverage === null ? "—" : `${preview.impliedLeverage}×`}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Quoted price</dt><dd>{price === null ? "—" : formatMark(price, market.places)}</dd></div>
          {preview.worstPrice !== null && <div className={ROW}><dt className="text-fg-3">Worst price allowed</dt><dd>{worst === null ? "—" : formatMark(worst, market.places)}</dd></div>}
          {levelDistance !== null && <div><div className={ROW}><dt className="text-fg-3">Take profit and stop loss distance</dt><dd>{spokenRate(levelDistance)}</dd></div><p className="mt-1 text-label leading-relaxed text-fg-3">{describeLevelDistance(levelDistance)}</p></div>}
        </dl>
        <div>
          <p className="text-label text-fg-3">Spread by position size{ownBands ? ", for your account" : ""}</p>
          <dl className="mt-2 space-y-1">
            {bands.map((band) => <div key={band.span} className={ROW}><dt className="text-fg-3">{band.span}</dt><dd>{band.rate}</dd></div>)}
          </dl>
          <p className="mt-2 text-label leading-relaxed text-fg-3">Each trade is charged the spread shown for each portion of the position that it opens or closes.{stress !== null && stress.size_spread_multiplier_bps !== 10_000 ? ` At the current stress level, these spreads are multiplied by ${formatMultiplier(stress.size_spread_multiplier_bps)}.` : ""}</p>
          {changes.map((line) => <p key={line} className="mt-2 text-label leading-relaxed text-amber">{line}</p>)}
        </div>
        <div>
          <p className="flex justify-between text-label"><span className="text-fg-3">Margin use after order</span><span className={useBps !== null && useBps > 9_000 ? "text-ember" : "text-glow"}>{useBps === null ? "—" : formatMovePercent(useBps).replace("+", "")}</span></p>
          <UseBar bps={useBps ?? 0} />
        </div>
        <div>
          <p className="flex justify-between text-label"><span className="text-fg-3">Share of the exposure limit</span><span className="text-fg-2">{capShare}%</span></p>
          <div aria-hidden="true" className="mt-2 flex h-1.5 gap-1">
            {Array.from({ length: 8 }, (_, segment) => <span key={segment} className={`flex-1 rounded-sm ${segment < filled ? "bg-glow/70" : "bg-line-2"}`} />)}
          </div>
          <p className="mt-2 text-label leading-relaxed text-fg-3">The house limits its net exposure in {market.symbol} to {usd(preview.houseCap)}, across all traders&apos; positions. The bar shows your order&apos;s size as a share of that limit. An order that would take the house&apos;s exposure beyond the limit is rejected, even if the order alone is smaller than the limit.</p>
        </div>
        <dl className="space-y-3 border-t border-line pt-4 text-label leading-relaxed text-fg-3">
          <div><dt className="text-fg-2">Reference</dt><dd>The reference price combines live prices from the exchanges and data providers that this market uses into a single price.</dd></div>
          <div><dt className="text-fg-2">Execution</dt><dd>Orders are executed at the reference price plus or minus the spread. The spread depends on the size of your position, the market&apos;s stress level and any extra spread applied to your account.</dd></div>
          <div><dt className="text-fg-2">Risk</dt><dd>Spreads widen when the market is under stress. {describeCloseout(closeoutBps)}</dd></div>
        </dl>
      </div>
    </details>
  );
}
