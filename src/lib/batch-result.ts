/** What a cancel-all or close-all answer says happened, read from the events it returned (engine V44). */

import type { EngineEvent, MarketId, Reject } from "./engine/types";
import { describeReject } from "./messages";

/** A message for the user, with the tone a toast shows it in. */
export interface BatchSummary {
  tone: "ok" | "error" | "info";
  text: string;
}

/**
 * The refusals that can only be of the whole request: its authorisation, its screening, or the
 * protocol version. An entry's own rejection is one a single order gets after those checks
 * (`validate_order` and `execute` in the engine), none of them in this set.
 */
const REQUEST_LEVEL: ReadonlySet<Reject["kind"]> = new Set([
  "batch_unsupported", "missing_signature", "invalid_signature", "invalid_nonce", "expired", "expiry_too_far",
  "session_key_scope", "invalid_session_key", "session_key_unsupported", "too_many_session_keys", "access",
]);

/**
 * The reason the node refused the whole request, or null when it ran. A refusal is a lone
 * `order_rejected` with `client_id` 0, and so is the rejection of entry 0 when it is the only
 * event, so the two are told apart here: with several entries every one of them yields at least
 * one event, so a lone event is the request's; with one entry it is the request's only when its
 * reason is a request-level kind. A refusal the engine adds later that is not in
 * `REQUEST_LEVEL` is read as the one entry's.
 */
export function wholeRefusal(events: readonly EngineEvent[], entryCount: number): Reject | null {
  const [only] = events;
  if (events.length !== 1 || only === undefined || only.type !== "order_rejected" || only.client_id !== 0) return null;
  return entryCount > 1 || REQUEST_LEVEL.has(only.reason.kind) ? only.reason : null;
}

/** What became of one entry of a close-all. */
export type EntryOutcome =
  | { market: MarketId; result: "closed" }
  | { market: MarketId; result: "refused"; reason: Reject }
  /** Neither a fill nor a rejection came back for it; the page reads the account again to show where it stands. */
  | { market: MarketId; result: "unconfirmed" };

export type CloseAllOutcome = { kind: "refused"; reason: Reject } | { kind: "entries"; entries: EntryOutcome[] };

/** Matches each entry, by its list index and its market, to its rejection or its fill. */
export function closeAllOutcome(markets: readonly MarketId[], events: readonly EngineEvent[]): CloseAllOutcome {
  const reason = wholeRefusal(events, markets.length);
  if (reason !== null) return { kind: "refused", reason };
  return {
    kind: "entries",
    entries: markets.map((market, index): EntryOutcome => {
      const refused = events.find((e) => e.type === "order_rejected" && e.client_id === index);
      if (refused !== undefined && refused.type === "order_rejected") return { market, result: "refused", reason: refused.reason };
      return events.some((e) => e.type === "fill" && e.market === market) ? { market, result: "closed" } : { market, result: "unconfirmed" };
    }),
  };
}

const positions = (n: number) => `${n} ${n === 1 ? "position" : "positions"}`;

/**
 * Why one market did not close, as a clause that follows its name.
 * Error cases:
 * - the entry closed, which has no reason; the caller passes only the others
 */
function whyNot(symbol: string, outcome: EntryOutcome): string {
  if (outcome.result === "unconfirmed") return `${symbol} could not be confirmed closed`;
  if (outcome.result === "closed") throw new Error("a closed entry has no reason");
  const { reason } = outcome;
  switch (reason.kind) {
    case "slippage": return `${symbol} moved past its slippage bound`;
    case "market_closed": return `${symbol}'s market is closed`;
    case "no_price": return `${symbol} has no price right now`;
    // A position closed elsewhere since the list was built: the engine refuses the empty reduce-only order.
    case "reduce_only": return `${symbol} had no position left to close`;
    default: return `${symbol}: ${describeReject(reason).replace(/\.$/, "")}`;
  }
}

/** The one toast a close-all click shows: how many closed, and each market that did not, by name. */
export function describeCloseAll(outcome: CloseAllOutcome, symbolOf: (market: MarketId) => string): BatchSummary {
  if (outcome.kind === "refused") return { tone: "error", text: `Nothing was closed. ${describeReject(outcome.reason)}` };
  const { entries } = outcome;
  const failed = entries.filter((e) => e.result !== "closed");
  const closed = entries.length - failed.length;
  if (failed.length === 0) return { tone: "ok", text: `Closed ${positions(closed)}.` };
  const reasons = failed.map((e) => whyNot(symbolOf(e.market), e)).join("; ");
  return { tone: "error", text: closed === 0 ? `No position was closed: ${reasons}.` : `Closed ${closed} of ${positions(entries.length)}; ${reasons}.` };
}

/** The one toast a cancel-all click shows. Any rejection is the whole request's: it has no entries. */
export function describeCancelAll(events: readonly EngineEvent[]): BatchSummary {
  const refused = events.find((e) => e.type === "order_rejected");
  if (refused !== undefined && refused.type === "order_rejected") return { tone: "error", text: `Nothing was cancelled. ${describeReject(refused.reason)}` };
  const n = events.filter((e) => e.type === "order_cancelled").length;
  if (n === 0) return { tone: "info", text: "No resting orders were left to cancel." };
  return { tone: "ok", text: `Cancelled ${n} ${n === 1 ? "order" : "orders"}.` };
}
