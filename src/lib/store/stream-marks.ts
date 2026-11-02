/**
 * Marks between the node's reads: the stream's `prices` commands folded into each market's quote
 * book under the engine's index rule (`MarkFolder`, the fold the chart's history scan uses), so a
 * market's mark moves as the node moves it without a read. The book begins empty at the first
 * read, and a market shows no streamed mark until every quote the node held then has aged out; a
 * read always wins over a streamed mark it is not older than.
 */

import type { Fixed } from "../fixed";
import { MarkFolder } from "../engine/live-marks";
import { sessionRule, type SessionRule } from "../engine/mark-session";
import type { MarketId, MarketView, PriceRules, StreamMessage } from "../engine/types";

/** Whether the mark can be replayed from the stream's quotes alone: not futures-priced (roll state), not an equity (corporate-action state), not quoted in another currency (FX market state). */
export function streamPriced(view: MarketView): boolean {
  return (view.contracts === undefined || view.contracts.length === 0) && view.asset_class !== "equity" && view.quote_currency === undefined;
}

/** A rejection of a kind the fold applies itself (`marks.rs` `store_quotes`): a malformed, ahead-stamped or out-of-session quote. */
const FOLDED_REJECTION = /^(malformed quote|quote from .* (stamped \d+ms ahead|stamped or sequenced outside))/;

export interface StreamedMark {
  mark: Fixed;
  /** The log seq and sequenced time (Unix milliseconds) of the command that produced it. */
  seq: number;
  ts: number;
}

export class StreamMarks {
  private folder: MarkFolder | null = null;
  private listing = "";
  /** The newest mark per market not yet applied to the screen. */
  private fresh = new Map<MarketId, StreamedMark>();
  /** The newest mark per market, applied or not, which a read at an older seq must not replace. */
  private latest = new Map<MarketId, StreamedMark>();
  /** The log seq of the newest read; marks from commands at or before it are the read's to show. */
  private readSeq = -1;

  /** Follows the markets a read lists: the book is kept while their rules and schedules stand, and starts over when they change. */
  configure(views: readonly MarketView[]): void {
    const priced = views.filter(streamPriced);
    const listing = JSON.stringify(priced.map((v) => [v.id, v.price_rules, v.schedule]));
    if (this.folder !== null && listing === this.listing) return;
    const rules: Record<number, PriceRules> = Object.fromEntries(priced.map((v) => [v.id, v.price_rules]));
    const sessions: Record<number, SessionRule> = Object.fromEntries(priced.map((v) => [v.id, sessionRule(v.schedule)]));
    this.folder = new MarkFolder(0, rules, sessions);
    this.listing = listing;
    this.fresh.clear();
    this.latest.clear();
  }

  /** Forgets the books and marks, so streamed marks resume only after the next read and a fresh warm-up. */
  reset(): void {
    this.folder = null;
    this.listing = "";
    this.fresh.clear();
    this.latest.clear();
  }

  /** Folds one stream message in; true when it left a mark to show. */
  observe(message: StreamMessage): boolean {
    const folder = this.folder;
    if (folder === null) return false;
    const { cmd } = message;
    // A listing, parameter or session change, or a market opening or closing, may move what the node
    // prices from in ways the book does not follow: the next read starts the books afresh.
    if (cmd.type === "admin" || cmd.type === "signed_admin" || message.events.some((e) => e.type === "market_opened" || e.type === "market_closed")) {
      this.reset();
      return false;
    }
    // A rejection the fold does not apply to itself leaves that market's book unable to say what the node holds.
    const doubtful = new Set<MarketId>();
    for (const event of message.events) {
      if (event.type === "prices_rejected" && !FOLDED_REJECTION.test(event.reason)) doubtful.add(event.market);
    }
    if (cmd.type === "prices") folder.apply(cmd.market, cmd.quotes, message.ts);
    else folder.advance(message.ts);
    for (const market of doubtful) folder.listing(market, undefined, undefined);
    for (const { market } of folder.marks.splice(0)) {
      const fixed = folder.fixed.get(market);
      if (fixed === undefined || message.seq <= this.readSeq || doubtful.has(market)) continue;
      const streamed = { mark: fixed, seq: message.seq, ts: message.ts };
      this.fresh.set(market, streamed);
      this.latest.set(market, streamed);
    }
    return this.fresh.size > 0;
  }

  /** The marks not yet shown, each market's newest. */
  take(): Map<MarketId, StreamedMark> {
    const out = this.fresh;
    this.fresh = new Map();
    return out;
  }

  /**
   * Notes a read at log seq `seq` (null when the answer names none, which then wins over every streamed mark) and returns its markets with
   * the marks the stream holds from after it, so a read in flight while prices moved never steps
   * the screen back.
   */
  reconcile<M extends { id: MarketId; open: boolean; mark: Fixed | null }>(markets: readonly M[], seq: number | null): M[] {
    this.readSeq = seq ?? Number.POSITIVE_INFINITY; // an answer that names no seq cannot be told older than the stream, so it wins
    for (const [market, streamed] of this.latest) if (streamed.seq <= this.readSeq) this.latest.delete(market);
    for (const [market, streamed] of this.fresh) if (streamed.seq <= this.readSeq) this.fresh.delete(market);
    return markets.map((m) => {
      const streamed = this.latest.get(m.id);
      return streamed === undefined || !m.open ? m : { ...m, mark: streamed.mark };
    });
  }
}
