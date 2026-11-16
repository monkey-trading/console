/** The one plain-words state for which trading is paused on the trading page (monkey-trading/console#273): a single reason, what will end it, and whether closing still works. */

export type PausedCause = "handover" | "unlisted" | "closed" | "price" | "reduce_only";

export type PausedState = {
  cause: PausedCause;
  /** What the deal ticket says, in full sentences: why trading is paused and what will end it. */
  text: string;
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
    return { cause: "handover", text: "A new operator is taking over the trading server, so trading has been suspended. Trading will resume once the new operator's server has been verified.", closesAllowed: true };
  }
  if (input.unlisted) {
    return { cause: "unlisted", text: "A new operator is taking over the trading server, but this version of the console does not support the new server, so trading has been suspended. Trading will resume once the console has been updated.", closesAllowed: true };
  }
  if (!input.open) {
    return { cause: "closed", text: input.scheduleWords === null ? "This market is currently closed." : `This market is currently closed. Its trading hours are ${input.scheduleWords}.`, closesAllowed: true };
  }
  if (!input.priced) {
    return { cause: "price", text: "No live price is currently available for this market, so trading has been suspended. Trading will resume automatically once a live price is available again.", closesAllowed: true };
  }
  if (input.reduceOnly) {
    return { cause: "reduce_only", text: "This market is currently accepting only orders that reduce an existing position. You can still close your position from the Positions tab.", closesAllowed: true };
  }
  return null;
}
