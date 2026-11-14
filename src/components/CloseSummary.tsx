/** What an order that closes some or all of a position pays: its price, the realised result, the profit fee and what the account keeps. */

import type { ClosePreview } from "@/lib/close-preview";
import type { Side } from "@/lib/engine/types";
import { formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { roundToPlaces } from "@/lib/fixed-rounding";
import { formatRate } from "@/lib/format";
import { formatMark } from "@/lib/price-format";

const ROW = "flex justify-between gap-3";

/**
 * The close figures under the deal ticket's size. Exact ones are the fill's while nothing moves; a bound
 * says which way the fill can differ while the price holds: its price no worse, and what it keeps no less.
 * `converts` marks a market quoted in another currency, whose USD figures also need the FX rate to hold.
 */
export function CloseSummary({ close, side, places, converts }: { close: ClosePreview; side: Side; places: number; converts: boolean }) {
  const bound = !close.exact;
  // A market quoted in another currency books its result in USD at the FX index the fill meets.
  const holds = converts ? "the price and the FX rate hold" : "the price holds";
  // A sell closes a long at this price or better, a buy a short at this price or better.
  const priceWord = bound ? (side === "sell" ? "at least " : "at most ") : "";
  // A bound shows its figures rounded the way its claim reads: an "at most" price up, an "at least" amount down.
  const price = bound ? roundToPlaces(close.price, places, side === "sell" ? "down" : "up") : close.price;
  const least = (amount: bigint) => formatUsd(bound ? roundToPlaces(amount, 2, "down") : amount);
  return (
    <div className="mt-4 rounded border border-line-2 px-3 py-3 text-caption">
      <p className="text-label tracking-caps text-fg-3 uppercase">{close.whole ? "Closes the whole position" : close.reverses ? "Closes the whole position and opens the other side" : `Closes ${formatFixedPlaces(close.closed, 6)} of the position`}</p>
      <dl className="mt-2 space-y-1">
        <div className={ROW}><dt className="text-fg-3">Price</dt><dd>{priceWord}{formatMark(price, places)}</dd></div>
        <div className={ROW}><dt className="text-fg-3">Realised</dt><dd>{bound ? "at least " : ""}{least(close.realised)}</dd></div>
        {/* A bound's fill can do better, and a better price can turn a loss into a gain that pays the fee. */}
        <div className={ROW}><dt className="text-fg-3">Profit fee</dt><dd>{bound ? `${formatRate(close.feeBps)} of any gain, ${formatUsd(close.fee)} at this price` : close.realised > 0n ? `${formatRate(close.feeBps)} of the gain, ${formatUsd(close.fee)}` : "none on a loss"}</dd></div>
        <div className={ROW}><dt className="text-fg-2">You keep</dt><dd className={close.net < 0n ? "text-ember" : "text-glow"}>{bound ? "at least " : ""}{least(close.net)}</dd></div>
      </dl>
      <p className="mt-2 text-label leading-relaxed text-fg-3">
        {bound
          ? `A bound while ${holds}: the fill's price is no worse than this and its fee rate, which falls as the hold lengthens, no higher, so it keeps at least this. A move against you fills as far as the worst price your slippage bound allows.`
          : `Exact while ${converts ? "the price, the FX rate" : "the price"} and the fee rate hold. A move against you fills as far as the worst price your slippage bound allows.`}
      </p>
    </div>
  );
}
