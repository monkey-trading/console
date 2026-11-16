/** What an order that closes some or all of a position pays: its price, the realised result, the profit fee and what the account keeps. */

import type { ReactNode } from "react";

import type { ClosePreview, CloseShape } from "@/lib/close-preview";
import type { Side } from "@/lib/engine/types";
import { formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { roundToPlaces } from "@/lib/fixed-rounding";
import { formatRate } from "@/lib/format";
import { formatMark } from "@/lib/price-format";

const ROW = "flex justify-between gap-3";

/** `shown` in a box as tall as `longest` would make it, so a text that changes with the clock never moves what sits under it. */
function Steady({ shown, longest }: { shown: ReactNode; longest: ReactNode }) {
  return <span className="grid"><span className="col-start-1 row-start-1">{shown}</span><span aria-hidden className="invisible col-start-1 row-start-1">{longest}</span></span>;
}

/**
 * The close figures under the deal ticket's size. Exact ones are the fill's while nothing moves; a bound
 * says which way the fill can differ while the price holds: its price no worse, and what it keeps no less.
 * `converts` marks a market quoted in another currency, whose USD figures also need the FX rate to hold.
 * While the figures are withheld (`close` null) the box keeps its place, its figures unseen and `why` in
 * the note's place, so the controls under it stay where they are.
 */
export function CloseSummary({ shape, close, why, side, places, converts }: { shape: CloseShape; close: ClosePreview | null; why: string | null; side: Side; places: number; converts: boolean }) {
  const bound = close === null || !close.exact;
  // A market quoted in another currency books its result in USD at the FX index the fill meets.
  const holds = converts ? "the price and exchange rate hold" : "the price holds";
  // A sell closes a long at this price or better, a buy a short at this price or better.
  const priceWord = bound ? (side === "sell" ? "at least " : "at most ") : "";
  // A bound shows its figures rounded the way its claim reads: an "at most" price up, an "at least" amount down.
  const price = close === null ? 0n : bound ? roundToPlaces(close.price, places, side === "sell" ? "down" : "up") : close.price;
  const least = (amount: bigint) => formatUsd(bound ? roundToPlaces(amount, 2, "down") : amount);
  const boundNote = `These are limits, not exact figures. If ${holds}, you close at this price or better and keep at least this much, since the fee rate only falls. If the price moves against you, the order can still fill at a worse price, within your max slippage.`;
  const exactNote = `These figures are exact if ${converts ? "the price, exchange rate" : "the price"} and fee rate don't change. If the price moves against you, the order can still fill at a worse price, within your max slippage.`;
  const boundFee = close === null ? "" : `${formatRate(close.feeBps)} of any profit, ${formatUsd(close.fee)} at this price`;
  const fee = close === null ? "" : bound ? boundFee : close.realised > 0n ? `${formatRate(close.feeBps)} of the profit, ${formatUsd(close.fee)}` : "none without a profit";
  return (
    <div className="mt-4 rounded border border-line-2 px-3 py-3 text-caption">
      <p className="text-label tracking-caps text-fg-3 uppercase">{shape.whole ? "Closes the whole position" : shape.reverses ? "Closes the whole position and opens the other side" : `Closes ${formatFixedPlaces(shape.closed, 6)} of the position`}</p>
      {/* Withheld figures are laid out but hidden, so they take no more room than shown ones. */}
      <dl className={`mt-2 space-y-1 ${close === null ? "invisible" : ""}`}>
        <div className={ROW}><dt className="text-fg-3">Price</dt><dd>{close === null ? "—" : <>{priceWord}{formatMark(price, places)}</>}</dd></div>
        <div className={ROW}><dt className="text-fg-3">Profit or loss</dt><dd>{close === null ? "—" : <>{bound ? "at least " : ""}{least(close.realised)}</>}</dd></div>
        {/* A bound's fill can do better, and a better price can turn a loss into a gain that pays the fee. */}
        <div className={ROW}><dt className="text-fg-3">Profit fee</dt><dd><Steady shown={close === null ? "—" : fee} longest={boundFee} /></dd></div>
        <div className={ROW}><dt className="text-fg-2">You keep</dt><dd className={close !== null && close.net < 0n ? "text-ember" : "text-glow"}>{close === null ? "—" : <>{bound ? "at least " : ""}{least(close.net)}</>}</dd></div>
      </dl>
      <p className="mt-2 text-label leading-relaxed text-fg-3">
        <Steady shown={close === null ? why : bound ? boundNote : exactNote} longest={boundNote} />
      </p>
    </div>
  );
}
