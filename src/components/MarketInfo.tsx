/** The ticket's "Market info" section: hours, stress, the spread bands and any pending listing change, margin, price terms and the house's room. */

import type { ListingNotice, Side, StressLevel } from "@/lib/engine/types";
import { bpsOf, formatUsd, type Fixed } from "@/lib/fixed";
import { formatMovePercent } from "@/lib/format";
import type { MarketModel } from "@/lib/models";
import { formatMark } from "@/lib/price-format";
import { CLOSE_OUT_BPS } from "@/lib/pricing";
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

/** What the market's stress level adds now: the size spread's multiplier and a minimum on every fill. */
function stressTerms(level: StressLevel): string {
  const minimum = level.min_spread_bps > 0 ? `, and ${level.min_spread_bps} ${level.min_spread_bps === 1 ? "bp" : "bps"} on every fill` : "";
  return `Size spread ×${formatMultiplier(level.size_spread_multiplier_bps)}${minimum}`;
}

/**
 * `price` is the price a market order on `side` would be sent at, with the worst price `slippageBps`
 * allows; null shows neither. `stress` is the market's level's terms from the node's parameters, and
 * `notice` its pending listing notice; null when the node has given neither. `paramsNote` says why
 * the parameters are missing when their read failed or the node does not serve them.
 */
export function MarketInfo({ market, preview, side, price, slippageBps, stress, notice, paramsNote }: { market: MarketModel; preview: TicketPreview; side: Side; price: Fixed | null; slippageBps: number; stress: StressLevel | null; notice: ListingNotice | null; paramsNote: string | null }) {
  const worst = price === null ? null : side === "buy" ? price + bpsOf(price, slippageBps) : price - bpsOf(price, slippageBps);
  const useBps = preview.marginUseBps;
  const filled = preview.houseCap > 0n ? Math.min(8, Math.ceil(Number((preview.markNotional * 8n) / preview.houseCap) || 0)) : 0;
  const capShare = preview.houseCap > 0n ? Number((preview.markNotional * 100n) / preview.houseCap) : 0;
  const stressName = STRESS_NAMES[market.stress] ?? "Normal";
  const bands = bandRows(market.view.spread_tiers, spreadRate);
  const changes = notice === null ? [] : describeNotice(notice);
  return (
    <details className="group border-t border-line">
      <summary className="flex items-center justify-between px-4 py-4 text-label tracking-caps text-fg-3 uppercase hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-glow sm:px-5">
        Market info <span aria-hidden="true" className="group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-5 px-4 pb-5 text-caption sm:px-5">
        <dl className="space-y-3">
          <div className={ROW}><dt className="text-fg-3">Market hours</dt><dd className={market.open ? "text-glow" : "text-ember"}>{market.open ? "Open" : "Closed"} · {describeSchedule(market.view.schedule)}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Stress level</dt><dd className={`text-right ${STRESS_TONE[market.stress] ?? ""}`}>{market.stress} · {stressName}{stress !== null ? <span className="block text-fg-3">{stressTerms(stress)}</span> : paramsNote !== null && <span className="block text-fg-3">{paramsNote}</span>}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Margin rate</dt><dd>{preview.marginRateBps === null ? "—" : `${formatMovePercent(preview.marginRateBps).replace("+", "")} of the resulting position`}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Required margin</dt><dd>{usd(preview.marginAdded)}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Implied leverage</dt><dd>{preview.impliedLeverage === null ? "—" : `${preview.impliedLeverage}×`}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Quoted price</dt><dd>{price === null ? "—" : formatMark(price, market.places)}</dd></div>
          {preview.worstPrice !== null && <div className={ROW}><dt className="text-fg-3">Worst price allowed</dt><dd>{worst === null ? "—" : formatMark(worst, market.places)}</dd></div>}
        </dl>
        <div>
          <p className="text-label text-fg-3">Spread by position size</p>
          <dl className="mt-2 space-y-1">
            {bands.map((band) => <div key={band.span} className={ROW}><dt className="text-fg-3">{band.span}</dt><dd>{band.rate}</dd></div>)}
          </dl>
          <p className="mt-2 text-label leading-relaxed text-fg-3">Each fill pays these on the part of your position it opens or closes{stress !== null && stress.size_spread_multiplier_bps !== 10_000 ? `, ×${formatMultiplier(stress.size_spread_multiplier_bps)} at this stress level` : ""}.</p>
          {changes.map((line) => <p key={line} className="mt-2 text-label leading-relaxed text-amber">{line}</p>)}
        </div>
        <div>
          <p className="flex justify-between text-label"><span className="text-fg-3">Margin use after order</span><span className={useBps !== null && useBps > 9_000 ? "text-ember" : "text-glow"}>{useBps === null ? "—" : formatMovePercent(useBps).replace("+", "")}</span></p>
          <UseBar bps={useBps ?? 0} />
        </div>
        <div>
          <p className="flex justify-between text-label"><span className="text-fg-3">Size against the house's cap</span><span className="text-fg-2">{capShare}%</span></p>
          <div aria-hidden="true" className="mt-2 flex h-1.5 gap-1">
            {Array.from({ length: 8 }, (_, segment) => <span key={segment} className={`flex-1 rounded-sm ${segment < filled ? "bg-glow/70" : "bg-line-2"}`} />)}
          </div>
          <p className="mt-2 text-label leading-relaxed text-fg-3">The house takes at most {usd(preview.houseCap)} net in {market.symbol}. The node checks the house's net exposure after your order, which this does not know.</p>
        </div>
        <dl className="space-y-3 border-t border-line pt-4 text-label leading-relaxed text-fg-3">
          <div><dt className="text-fg-2">Reference</dt><dd>The multi-venue median of the node's price feeds.</dd></div>
          <div><dt className="text-fg-2">Execution</dt><dd>Fills at the reference price moved by the spread: the size bands on the part of your position the order opens or closes, any stress minimum, and any toxicity add-on your account carries.</dd></div>
          <div><dt className="text-fg-2">Risk</dt><dd>Stress widens the spread. Your account is closed out when equity falls below {CLOSE_OUT_BPS / 100}% of its margin.</dd></div>
        </dl>
      </div>
    </details>
  );
}
