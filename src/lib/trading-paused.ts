/** The one plain-words state for which trading is paused on the trading page (monkey-trading/console#273): a single reason, what will end it, and whether closing still works. */

export type PausedCause = "handover" | "unlisted" | "closed" | "price" | "reduce_only";

export type PausedState = {
  cause: PausedCause;
  /** Completes "Trading is paused: …". */
  why: string;
  /** Closing positions stays open under this state. */
  closesAllowed: boolean;
};

/**
 * The reason trading is paused for the selected market, or null when it is not. One cause wins, in
 * the order a trader asks about them: an operator handover first, then an operator on a node this console does not list, then a closed market, then no
 * usable price, then a reduce-only market. A node the console does not trust is the caller's own
 * gate and never reaches here.
 */
export function tradingPaused(input: {
  /** The console waits on the node the chain names: an operator handover is in progress. */
  handover: boolean;
  /** Rotation is on and the operator now named runs on a node this build does not list, so the console stays on a node that is handing over. */
  unlisted: boolean;
  /** The market's sessions are open now. */
  open: boolean;
  /** The schedule in words, for what will end the closed state; null when unknown. */
  scheduleWords: string | null;
  /** A usable mark exists. */
  priced: boolean;
  /** The market refuses orders that add risk. */
  reduceOnly: boolean;
}): PausedState | null {
  if (input.handover) {
    return { cause: "handover", why: "a new operator is taking over, and trading resumes once their server is verified", closesAllowed: true };
  }
  if (input.unlisted) {
    return { cause: "unlisted", why: "the new operator's server isn't supported by this version of the console, so it needs an update", closesAllowed: true };
  }
  if (!input.open) {
    return { cause: "closed", why: input.scheduleWords === null ? "the market is closed" : `the market is closed (${input.scheduleWords})`, closesAllowed: true };
  }
  if (!input.priced) {
    return { cause: "price", why: "there's no live price for this market right now", closesAllowed: true };
  }
  if (input.reduceOnly) {
    return { cause: "reduce_only", why: "this market only accepts orders that reduce a position, so you can still close", closesAllowed: true };
  }
  return null;
}
