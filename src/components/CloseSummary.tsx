/** What an order that closes some or all of a position pays: its price, the realised result, the profit fee and what the account keeps. */

import type { ClosePreview } from "@/lib/close-preview";
import type { Side } from "@/lib/engine/types";
import { formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { formatRate } from "@/lib/format";
import { formatMark } from "@/lib/price-format";

const ROW = "flex justify-between gap-3";

/**
 * The close figures under the deal ticket's size. Exact ones are the fill's while nothing moves; a bound
 * says which way the fill can differ: its price no worse, and what it keeps no less.
 */
export function CloseSummary({ close, side, places }: { close: ClosePreview; side: Side; places: number }) {
  const bound = !close.exact;
  // A sell closes a long at this price or better, a buy a short at this price or better.
  const priceWord = bound ? (side === "sell" ? "at least " : "at most ") : "";
  return (
    <div className="mt-4 rounded border border-line-2 px-3 py-3 text-caption">
      <p className="text-label tracking-caps text-fg-3 uppercase">{close.whole ? "Closes the whole position" : `Closes ${formatFixedPlaces(close.closed, 6)} of the position`}</p>
      <dl className="mt-2 space-y-1">
        <div className={ROW}><dt className="text-fg-3">Price</dt><dd>{priceWord}{formatMark(close.price, places)}</dd></div>
        <div className={ROW}><dt className="text-fg-3">Realised</dt><dd>{bound ? "at least " : ""}{formatUsd(close.realised)}</dd></div>
        <div className={ROW}><dt className="text-fg-3">Profit fee</dt><dd>{close.realised > 0n ? `${formatRate(close.feeBps)} of the gain, ${formatUsd(close.fee)}` : "none on a loss"}</dd></div>
        <div className={ROW}><dt className="text-fg-2">You keep</dt><dd className={close.net < 0n ? "text-ember" : "text-glow"}>{bound ? "at least " : ""}{formatUsd(close.net)}</dd></div>
      </dl>
      <p className="mt-2 text-label leading-relaxed text-fg-3">
        {bound
          ? "A bound: the fill's price is no worse than this and its fee rate, which falls as the hold lengthens, no higher, so it keeps at least this."
          : "Exact while the price and the fee rate hold."}
      </p>
    </div>
  );
}
