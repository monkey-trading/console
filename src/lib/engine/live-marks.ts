/**
 * A one-off signed read of the log from a seq for the index marks the chart backfills with: every
 * `prices` command folds into a per-market quote book, and the index the engine's rule gives at the
 * command's sequenced time becomes a mark. The read is bounded, and it resolves with the marks it
 * kept when it stops short; completion follows a cursor over log offsets (`log-scan.ts`), so a
 * heartbeat ends the read only once the cursor has reached the head it names. The listing in force
 * at the read's start is the node's current one: an `upsert_market` the window carries is honored
 * from its seq, but marks before the first such listing replay under today's rules and schedule,
 * which a bounded read cannot rewind to check.
 */

import { fixedToNumber, type Fixed } from "../fixed";
import { foldQuotes, indexFixed, type QuoteBook } from "./mark-index";
import { sessionRule, type SessionRule } from "./mark-session";
import { atOrPast, position, type ScanDeps } from "./log-scan";
import type { MarketId, PriceRules, Schedule, SourceQuote } from "./types";
import { parseFrameMessage, parseSignedFrame } from "./wire";

/** One mark a scan of the log found: the market's index at the command's sequenced time. */
export interface ScannedMark {
  market: MarketId;
  /** The command's sequenced time, Unix milliseconds. */
  ts: number;
  /** The index mid at `ts`, in dollars; a float, for the chart only. */
  mid: number;
}

/** When a scan of the log stops: at any of these, whichever comes first. */
export interface ScanBudget {
  /** The most log entries read. */
  maxMessages: number;
  /** The most wall-clock time the scan may take, in milliseconds (the scheduler's clock). */
  maxMs: number;
  /** Only marks within this much time of a market's newest mark are kept, so each market's window sits nearest the head. */
  coverMs: number;
  /** The closest two marks for one market may sit, in milliseconds, so dense updates thin to chart granularity. */
  stepMs: number;
}

/**
 * Folds `prices` commands into index marks, thinned to `stepMs`; one folder per scan over the
 * signed log read. Quotes the market's session rule excludes (`crates/core/src/marks.rs` rejects
 * quotes outside one open session from `V21`) are dropped before the fold, as are markets with no
 * rule in `rules`. A market emits no mark until every quote the engine held when the scan started
 * must have expired — the scan's book begins empty, so earlier marks could otherwise price from a
 * source set the engine found divergent. Listing changes the log carries
 * (`AdminCommand::UpsertMarket`) replace the rules and schedule in force from that seq on, and
 * clear the book the old listing built.
 */
export class MarkFolder {
  private book: QuoteBook = {};
  private readonly lastAt: Record<number, number> = {};
  /** The first command's time per market: marks are trusted only a freshness window later. */
  private readonly firstAt: Record<number, number> = {};
  readonly marks: ScannedMark[] = [];
  /** Each market's newest mark as the engine's fixed point, for a caller that shows the mark itself rather than plotting it. */
  readonly fixed = new Map<number, Fixed>();

  constructor(
    private readonly stepMs: number,
    private rules: Readonly<Record<number, PriceRules>>,
    private sessions: Readonly<Record<number, SessionRule>>,
  ) {}

  /**
   * Folds one `prices` command into its market's book and advances every ruled market to the
   * command's sequenced time: the engine recomputes marks on each command, so a tick or another
   * market's update can move this market's index by expiring a source.
   */
  apply(market: MarketId, quotes: readonly SourceQuote[], atMs: number): void {
    const rule = this.rules[market];
    if (rule !== undefined) {
      const session = this.sessions[market];
      const usable = session === undefined ? quotes : quotes.filter((quote) => session.inSession(quote.ts, atMs, rule.max_age_ms));
      this.book = foldQuotes(this.book, market, usable, atMs);
    }
    this.advance(atMs);
  }

  /** Advances every ruled market to `atMs`: quotes that could not count at the sequenced time are pruned from the book (`futures.rs` `retain_session_quotes` — across a session close the market has no price), and each book's index becomes a mark when the rules give a price. */
  advance(atMs: number): void {
    for (const [market, rule] of Object.entries(this.rules)) {
      const id = Number(market);
      const session = this.sessions[id];
      let book = this.book;
      if (session !== undefined && book[id] !== undefined) {
        const held = Object.entries(book[id] ?? {}).filter(([, quote]) => session.inSession(quote.ts, atMs, rule.max_age_ms));
        book = { ...book, [id]: Object.fromEntries(held) };
      }
      this.book = book;
      const first = this.firstAt[id] ?? (this.firstAt[id] = atMs);
      const fixed = indexFixed(this.book[id], rule, atMs);
      const last = this.lastAt[id] ?? Number.NEGATIVE_INFINITY;
      // A quote exactly max_age old still counts, so the warm-up ends one millisecond past it:
      // only then must every quote the engine held when the scan started have expired.
      if (fixed !== null && atMs - first > rule.max_age_ms && atMs - last >= this.stepMs) {
        this.marks.push({ market: id, ts: atMs, mid: fixedToNumber(fixed) });
        this.fixed.set(id, fixed);
        this.lastAt[id] = atMs;
      }
    }
  }

  /** Applies an `UpsertMarket` the log carries: the rules and schedule in force change at its seq,
   * and a listing the bounded replay cannot price excludes the market from that seq on.
   * Markets the scan was built without — futures-priced ones a bounded read cannot replay — stay
   * excluded: a listing in the log cannot re-enable them. */
  listing(market: MarketId, rule: PriceRules | undefined, schedule: Schedule | undefined, excluded = false): void {
    if (!(market in this.rules)) return;
    if (excluded) {
      const rules = { ...this.rules };
      delete rules[market];
      this.rules = rules;
      const sessions = { ...this.sessions };
      delete sessions[market];
      this.sessions = sessions;
    } else {
      if (rule !== undefined) this.rules = { ...this.rules, [market]: rule };
      if (schedule !== undefined) this.sessions = { ...this.sessions, [market]: sessionRule(schedule) };
    }
    const book = { ...this.book };
    delete book[market];
    this.book = book;
    delete this.lastAt[market];
    delete this.firstAt[market];
  }
}

/**
 * Reads the log from seq `fromSeq`, folding each `prices` command into the book for `rules`' markets
 * and keeping the index each yields. The read ends when the cursor reaches the head a heartbeat
 * names, when the budget is spent, or on a failure; it resolves with the marks within `coverMs` of
 * the newest mark kept, and rejects when the log gave nothing readable or a failure left no marks.
 * Error cases:
 * - the first entries: a frame is out of order or does not verify, or the connection fails
 * - a failure or the time budget after entries that yielded no marks
 */
export function scanForMarks(deps: ScanDeps, fromSeq: number, budget: ScanBudget, rules: Readonly<Record<number, PriceRules>>, sessions: Readonly<Record<number, SessionRule>>, dead?: () => boolean): Promise<ScannedMark[]> {
  return new Promise((resolve, reject) => {
    const challenge = deps.challenge();
    const path = `/v1/stream?signed=1&challenge=${challenge}&from=${fromSeq}`;
    const frames = deps.verifier.openFrames({ signer: deps.signer, chainId: deps.chainId, vault: deps.vault, challenge, pathAndQuery: path });
    const socket = deps.openSocket(deps.origin + path);
    const folder = new MarkFolder(budget.stepMs, rules, sessions);
    let expected = 0;
    let read = 0;
    let last: [number, number] | null = null;
    let done = false;
    const finish = (error: Error | null) => {
      if (done) return;
      done = true;
      deps.scheduler.clearTimeout(timer);
      socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      // A scan that read anything answers with what it kept; an empty read fails, on error or interruption.
      if (error && (last === null || folder.marks.length === 0)) reject(error);
      else resolve(nearestHead(folder.marks, budget.coverMs));
    };
    const timer = deps.scheduler.setTimeout(() => finish(new Error("scanning the log for the chart's history took too long.")), budget.maxMs);
    socket.onmessage = (event) => {
      if (done) return;
      // The store stopped or restarted while the read ran: close the socket and let the caller
      // discard the partial read.
      if (dead?.()) return finish(new Error("The scan was cancelled."));
      const text = typeof event.data === "string" ? event.data : null;
      const frame = text === null ? null : parseSignedFrame(text);
      if (text === null || frame === null || frame.n !== expected) return finish(new Error("The node's log stream skipped or sent an unsigned frame."));
      const checked = frames.verify(text);
      if (!checked.ok) return finish(new Error(`A log frame did not verify: ${checked.reason}.`));
      expected++;
      read++;
      const message = parseFrameMessage(checked.msg);
      if (message === null) return finish(new Error("A signed log frame carried a message the console does not know."));
      if (message.type === "heartbeat") {
        // Caught up: the flushed head the heartbeat names is at or before everything read.
        const reached = last ?? [fromSeq - 1, Number.MAX_SAFE_INTEGER];
        if (message.head === null || atOrPast(reached, position(message.head))) return finish(null);
        return;
      }
      if ("offset" in message) last = position(message.offset);
      if (message.type !== "command") {
        // The budget counts every entry read, not only commands.
        if (read >= budget.maxMessages) return finish(null);
        return;
      }
      // A rejected admin command is sequenced like any other: its listing change applies only
      // when the log's events say the engine applied it. Entries written before events existed
      // carry none, and are taken at their word.
      const refused = (message.events ?? []).some((event) => event.type === "admin_rejected");
      if (message.cmd.type === "prices") folder.apply(message.cmd.market, message.cmd.quotes, message.ts);
      else if (!refused && message.cmd.type === "admin" && message.cmd.action === "upsert_market" && message.cmd.id !== undefined) {
        folder.listing(message.cmd.id, message.cmd.price_rules, message.cmd.schedule, listingExcludes(message.cmd));
        // The engine advances every market on the listing's command too.
        folder.advance(message.ts);
      } else if (!refused && message.cmd.type === "signed_admin" && message.cmd.command?.action === "upsert_market" && message.cmd.command.id !== undefined) {
        folder.listing(message.cmd.command.id, message.cmd.command.price_rules, message.cmd.command.schedule, listingExcludes(message.cmd.command));
        folder.advance(message.ts);
      } else {
        // Every other command — a tick, an order — advances the books all the same.
        folder.advance(message.ts);
      }
      if (read >= budget.maxMessages) return finish(null);
    };
    socket.onclose = (event) => finish(new Error(`The connection to the node closed while scanning the log${closeDetail(event)}.`));
    socket.onerror = () => finish(new Error("The connection to the node failed while scanning the log."));
  });
}

/** Keeps, for each market, only the marks within `coverMs` of that market's newest mark, so a market's window sits nearest its own read edge. */
/** Whether a listing's spec is one the bounded replay cannot price: futures-priced, an equity,
 * or quoted in another currency (its marks need the FX market's index).
 */
function listingExcludes(spec: { contracts?: unknown[]; asset_class?: string; quote_currency?: unknown }): boolean {
  return (spec.contracts !== undefined && spec.contracts.length > 0) || spec.asset_class === "equity" || spec.quote_currency !== undefined;
}

function nearestHead(marks: readonly ScannedMark[], coverMs: number): ScannedMark[] {
  const newestByMarket = new Map<number, number>();
  for (const mark of marks) {
    newestByMarket.set(mark.market, Math.max(newestByMarket.get(mark.market) ?? Number.NEGATIVE_INFINITY, mark.ts));
  }
  return marks.filter((mark) => {
    const newest = newestByMarket.get(mark.market);
    return newest !== undefined && mark.ts >= newest - coverMs;
  });
}

/** The close code a socket's close event carries, when it carries one, for the failure's reason. */
function closeDetail(event: unknown): string {
  if (typeof event !== "object" || event === null || !("code" in event)) return "";
  const code: unknown = event.code;
  return typeof code === "number" ? ` (code ${code})` : "";
}
