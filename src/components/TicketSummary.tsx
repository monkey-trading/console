/** What the order will do before it is placed: the quote, the margin it uses, and the house's room. */

import { formatPrice } from "@/lib/price-format";
import { fixedToNumber, formatFixedPlaces, type Fixed } from "@/lib/fixed";
import { formatMovePercent } from "@/lib/format";
import type { MarketModel } from "@/lib/models";
import type { TicketPreview } from "@/lib/ticket";

const usd = (value: Fixed) => `$${formatFixedPlaces(value, 2)}`;

/** The bar fills to `bps` of its width, from 0 to 10,000. */
function UseBar({ bps }: { bps: number }) {
  const width = Math.min(Math.max(bps, 0), 10_000) / 100;
  const tone = bps > 9_000 ? "bg-alarm" : bps > 6_000 ? "bg-amber" : "bg-glow";
  return (
    <div aria-hidden="true" className="mt-2 h-1.5 rounded-sm bg-line-2">
      <div className={`h-full rounded-sm ${tone}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function TicketSummary({ market, preview, notional }: { market: MarketModel; preview: TicketPreview; notional: Fixed }) {
  const quote = preview.quote;
  const useBps = preview.marginUseBps;
  const filled = preview.houseCap > 0n ? Math.min(8, Math.ceil(Number((notional * 8n) / preview.houseCap) || 0)) : 0;
  const over = notional > preview.houseCap;
  return (
    <>
      <dl className="mt-5 space-y-3 border-y border-line py-4 text-caption">
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">Quoted price</dt>
          <dd>{quote ? formatPrice(fixedToNumber(quote.price), market.places) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">Spread paid</dt>
          <dd>{quote ? `${formatMovePercent(quote.spreadBps).replace("+", "")} of index` : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">Worst price allowed</dt>
          <dd>{preview.worstPrice ? formatPrice(fixedToNumber(preview.worstPrice), market.places) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">Required margin</dt>
          <dd><output aria-live="polite" aria-atomic="true"><span className="sr-only">Required margin: </span>{usd(preview.marginAdded)}</output></dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">Counterparty</dt>
          <dd>Protocol house</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between text-label">
        <span className="text-fg-3">Margin use after order</span>
        <span className={useBps !== null && useBps > 9_000 ? "text-alarm" : "text-glow"}>{useBps === null ? "—" : `${formatMovePercent(useBps).replace("+", "")}`}</span>
      </div>
      <UseBar bps={useBps ?? 0} />
      <div className="mt-4 flex items-center justify-between text-label">
        <span className="text-fg-3">House capacity</span>
        <span className={over ? "text-alarm" : "text-glow"}>{over ? "Over the cap" : "Risk checked"}</span>
      </div>
      <div aria-hidden="true" className="mt-2 flex h-1.5 gap-1">
        {Array.from({ length: 8 }, (_, segment) => <span key={segment} className={`flex-1 rounded-sm ${segment < filled ? (over ? "bg-alarm/70" : "bg-glow/70") : "bg-line-2"}`} />)}
      </div>
      <p className="mt-2 text-label leading-relaxed text-fg-3">The house takes at most {usd(preview.houseCap)} net in {market.symbol}. This order is {usd(notional)}.</p>
    </>
  );
}
