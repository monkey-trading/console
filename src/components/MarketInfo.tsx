/** The ticket's "Market info" section: hours, stress, margin, price terms and the house's room. */

import { formatUsd, type Fixed } from "@/lib/fixed";
import { formatMovePercent } from "@/lib/format";
import type { MarketModel } from "@/lib/models";
import { formatMark } from "@/lib/price-format";
import { CLOSE_OUT_BPS, STRESS_SPREAD_BPS } from "@/lib/pricing";
import { describeSchedule } from "@/lib/schedule";
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

export function MarketInfo({ market, preview, notional }: { market: MarketModel; preview: TicketPreview; notional: Fixed }) {
  const useBps = preview.marginUseBps;
  const filled = preview.houseCap > 0n ? Math.min(8, Math.ceil(Number((notional * 8n) / preview.houseCap) || 0)) : 0;
  const capShare = preview.houseCap > 0n ? Number((notional * 100n) / preview.houseCap) : 0;
  const stress = STRESS_NAMES[market.stress] ?? "Normal";
  return (
    <details className="group border-t border-line">
      <summary className="flex items-center justify-between px-4 py-4 text-label tracking-caps text-fg-3 uppercase hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-glow sm:px-5">
        Market info <span aria-hidden="true" className="group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-5 px-4 pb-5 text-caption sm:px-5">
        <dl className="space-y-3">
          <div className={ROW}><dt className="text-fg-3">Market hours</dt><dd className={market.open ? "text-glow" : "text-ember"}>{market.open ? "Open" : "Closed"} · {describeSchedule(market.view.schedule)}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Stress level</dt><dd className={STRESS_TONE[market.stress] ?? ""}>{market.stress} · {stress}{market.stress > 0 ? ` (+${STRESS_SPREAD_BPS[market.stress]} bps)` : ""}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Margin rate</dt><dd>{formatMovePercent(preview.marginRateBps).replace("+", "")} of the resulting position</dd></div>
          <div className={ROW}><dt className="text-fg-3">Required margin</dt><dd>{usd(preview.marginAdded)}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Implied leverage</dt><dd>{preview.impliedLeverage === null ? "—" : `${preview.impliedLeverage}×`}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Quoted price</dt><dd>{preview.quote ? formatMark(preview.quote.price, market.places) : "—"}</dd></div>
          <div className={ROW}><dt className="text-fg-3">Worst price allowed</dt><dd>{preview.worstPrice ? formatMark(preview.worstPrice, market.places) : "—"}</dd></div>
        </dl>
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
          <div><dt className="text-fg-2">Execution</dt><dd>Fills at the reference price moved by the spread for your size.</dd></div>
          <div><dt className="text-fg-2">Risk</dt><dd>Stress widens the spread. Your account is closed out when equity falls below {CLOSE_OUT_BPS / 100}% of its margin.</dd></div>
        </dl>
      </div>
    </details>
  );
}
