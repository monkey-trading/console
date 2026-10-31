/**
 * The engine's reference index as the chart backfill replays it from the log's `prices` commands
 * (`crates/core/src/price.rs` `compute_index`, `crates/core/src/marks.rs` quote acceptance):
 * the median of each source's latest mid, fresh at the command's sequenced time. Arithmetic runs
 * in the engine's nine-place fixed point, so acceptance decisions (freshness aside) match the
 * engine exactly; the accepted mid becomes a float only as it leaves, for the chart.
 */

import { fixedToNumber, parseFixed, SCALE, type Fixed } from "../fixed";
import type { PriceRules, SourceQuote } from "./types";

/** One market's latest quote per source, as the log's `prices` commands fold into it. */
export type QuoteBook = Readonly<Record<number, Readonly<Record<string, Readonly<{ mid: Fixed; ts: number }>>>>>;

/** How far after the sequenced time a quote may be stamped and still count, as the engine's `MAX_QUOTE_LEAD_MS`. */
const QUOTE_LEAD_MS = 1_000;
/** The engine's `Fixed::MAX_INPUT` (`crates/core/src/fixed/mod.rs`): the largest mid a quote may carry. */
const MAX_INPUT = 1_000_000_000n * SCALE;
const BPS_SCALE = 10_000n;

/**
 * Folds one `prices` command into the book under the engine's per-quote acceptance rules
 * (`crates/core/src/marks.rs`): a malformed quote (a mid that is not a positive fixed point at
 * most `MAX_INPUT`, or a stamp before the epoch) or one stamped more than `QUOTE_LEAD_MS` after
 * the command is dropped; a quote older than the one held for its source does not replace it
 * unless the held one was stamped ahead and does not count yet. A kept quote counts from the
 * earlier of its stamp and the command's time, so the stored stamp is clamped as the engine
 * stores it from `V12`. The session rejection is applied by the caller, which holds the market's
 * schedule; the corporate-action rejections need state the replay does not carry. Returns a new
 * book; the input is not touched.
 */
export function foldQuotes(book: QuoteBook, market: number, quotes: readonly SourceQuote[], atMs: number): QuoteBook {
  const held: Record<string, { mid: Fixed; ts: number }> = { ...(book[market] ?? {}) };
  for (const quote of quotes) {
    const mid = parseFixed(quote.mid);
    // A contract-tagged quote is for a futures market; the engine refuses it for a spot one.
    if (quote.contract !== undefined) continue;
    if (mid === null || mid <= 0n || mid > MAX_INPUT || quote.ts < 0) continue;
    if (quote.ts - atMs > QUOTE_LEAD_MS) continue;
    const old = held[quote.source];
    if (old !== undefined && quote.ts < old.ts && old.ts <= atMs) continue;
    held[quote.source] = { mid, ts: Math.min(quote.ts, atMs) };
  }
  return { ...book, [market]: held };
}

/**
 * The index of one market's quotes at `nowMs`, or null when the engine's rule gives no price:
 * fewer fresh sources than `rules.min_sources`, or fresh sources spread wider than
 * `rules.max_divergence_bps` around the median. A quote is fresh when its stored stamp is no older
 * than `rules.max_age_ms` at `nowMs`; acceptance was decided when it was folded. The returned mid
 * is a float for the chart only; it can exceed `Number.MAX_SAFE_INTEGER` in fixed units, so the
 * last places of a huge mid are approximate, below any chart resolution.
 */
export function indexOf(book: Readonly<Record<string, { mid: Fixed; ts: number }>> | undefined, rules: PriceRules, nowMs: number): number | null {
  if (book === undefined) return null;
  const mids = Object.values(book)
    .filter((quote) => nowMs - quote.ts <= rules.max_age_ms)
    .map((quote) => quote.mid)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (mids.length < rules.min_sources) return null;
  const n = mids.length;
  const mid = n % 2 === 1 ? middle(mids) : evenMiddle(mids);
  const spreadBps = ((mids[n - 1] ?? mid) - (mids[0] ?? mid)) * BPS_SCALE / mid;
  return spreadBps > BigInt(rules.max_divergence_bps) ? null : fixedToNumber(mid);
}

/** The median of an odd-length sorted list, which always has a middle element. */
function middle(sorted: readonly Fixed[]): Fixed {
  const at = sorted[(sorted.length - 1) / 2];
  if (at === undefined) throw new Error("median of an empty quote set");
  return at;
}

/** The average of the two central mids of an even-length sorted list, truncated as the engine's `div_int(2)`. */
function evenMiddle(sorted: readonly Fixed[]): Fixed {
  const n = sorted.length;
  const lo = sorted[n / 2 - 1];
  const hi = sorted[n / 2];
  if (lo === undefined || hi === undefined) throw new Error("median of an even quote set with no center");
  return (lo + hi) / 2n;
}
