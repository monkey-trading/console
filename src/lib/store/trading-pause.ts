/**
 * Trading paused while the trading server changes: when a pause begins, the steps it goes through, each from something the console
 * observes, and when trading resumes. A pause begins once trading was live and the server in use has stopped serving while the follower
 * finds the operator moving to another server (`waiting`, or `unlisted`), or as the stream drops around a turn boundary at which the member
 * changes (a scheduled `confirming`), and it lasts across the move to a fresh store. While the server in use still serves, it still
 * trades, so the view stays as it is and only new orders wait, which the deal ticket and the banner say. A drop the follower calls an outage ends it with no resume, and the outage line says so, as
 * does a server that has taken over but whose prices do not come within `PRICE_WAIT_MS`: the server's own line then says why.
 */

import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { FollowStatus } from "../engine/operator-follow-status";
import type { Scheduler } from "../engine/live-stream";
import { CLOCK_FAILED, NEXT_REFUSED, SERVER_REFUSED, STILL_PAUSED, UNLISTED_NEXT, WALLET_HOLD } from "../trading-pause-words";
import { isPriced, isUnfed } from "../unpriced";
import type { ConsoleState } from "./state";

export type PauseStep = "connect" | "verify" | "prices" | "resume";
/** Where focus was when trading paused, told by what a trader sees of the control, and the phone pane it sat in: no element survives a move. */
export interface FocusPlace {
  tag: string;
  name: string;
  pane: string | null;
}
export type StepState = "done" | "current" | "waiting" | "failed";
export type Steps = Readonly<Record<PauseStep, StepState>>;

/**
 * What the trading view shows: nothing; the pause, its steps, whether it runs long, why a step failed, and what else holds it, such as a
 * request waiting in the wallet; or trading resumed, then leaving.
 */
export type PauseView =
  | { kind: "none" }
  | { kind: "paused"; steps: Steps; long: boolean; failure: string | null; hold: string | null }
  | { kind: "resumed"; leaving: boolean };

/** Whether `view` holds the trading view inert: while paused, and while "Trading resumed" shows, until the panel fades. */
export function holdsView(view: PauseView): boolean {
  return view.kind === "paused" || (view.kind === "resumed" && !view.leaving);
}

/** What the steps are read from. */
export interface PauseInput {
  follow: FollowStatus;
  /** Whether the session moved to another server's store since the pause began. */
  moved: boolean;
  stream: FeedStatus;
  attestation: AttestationStatus;
  marketsRead: boolean; // whether the server's markets have been read
  flowing: boolean; // whether the server prices its markets again (`pricesFlow`)
  ready: boolean; // whether prices reach the market on screen again (`readyToTrade`)
}

/** How long a pause runs before it says it is taking longer than usual, in milliseconds: the successor serves within seconds of the drop, as measured on a local stack, so this is several times that. */
export const LONG_PAUSE_MS = 30_000;
/** How long "Trading resumed" shows before the panel leaves, and how long it takes to leave, in milliseconds. */
export const RESUMED_MS = 1_500;
export const LEAVE_MS = 300;
/**
 * How long a server that has taken over, verified and streaming, may go without pricing the market on screen before the pause hands over to
 * the server's own explanation, in milliseconds: a server that has just taken over held every market unpriced for 24 s in the owner's demo.
 */
export const PRICE_WAIT_MS = 60_000;

const STEP_ORDER: readonly PauseStep[] = ["connect", "verify", "prices", "resume"];
const NOT_YET: Steps = { connect: "waiting", verify: "waiting", prices: "waiting", resume: "waiting" };

/** Whether `follow` begins a pause: the operator moving to another server, or a drop held as one. */
export function pauses(follow: FollowStatus): boolean {
  return follow.kind === "waiting" || follow.kind === "unlisted" || (follow.kind === "confirming" && follow.scheduled);
}

/** What a pause shows: its steps, why one failed, and what else holds it. */
export interface PauseShown {
  steps: Steps;
  failure: string | null;
  hold?: string;
}

/**
 * What `input` shows, or that the pause ends with no resume: `outage` when the console stayed on its server or the server moved to and its
 * stream is down, `serving` when the server in use serves again before any move, as it still trades.
 */
export function pauseSteps(input: PauseInput): PauseShown | "outage" | "serving" {
  const { follow } = input;
  // Until a move, or again when the server moved to is itself being left, the follower says how far the change has got.
  if (!input.moved || follow.kind === "waiting" || follow.kind === "unlisted") {
    if (!input.moved && follow.kind !== "confirming" && input.stream === "live") return follow.kind === "waiting" || follow.kind === "unlisted" ? "serving" : pauseStepsOnServer(input);
    switch (follow.kind) {
      case "confirming":
        return { steps: { ...NOT_YET, connect: "current" }, failure: null };
      case "unlisted":
        return { steps: { ...NOT_YET, connect: "failed" }, failure: UNLISTED_NEXT };
      case "waiting":
        switch (follow.stage) {
          case "connecting":
            return { steps: { ...NOT_YET, connect: "current" }, failure: null };
          case "verifying":
            return { steps: { ...NOT_YET, connect: "done", verify: "current" }, failure: null };
          case "wallet":
            return { steps: { ...NOT_YET, connect: "done", verify: "done", prices: "current" }, failure: null, hold: WALLET_HOLD };
          case "refused":
            return { steps: { ...NOT_YET, connect: "done", verify: "failed" }, failure: `${NEXT_REFUSED} ${STILL_PAUSED}` };
          case "clock":
            return { steps: { ...NOT_YET, connect: "done", verify: "failed" }, failure: CLOCK_FAILED };
          default:
            return follow.stage satisfies never;
        }
      case "pinned":
      case "following":
      case "failed":
        // The console stayed where it was: its stream down is an outage (its stream back resumes trading, above).
        return "outage";
      default:
        return follow satisfies never;
    }
  } else if (follow.kind !== "confirming" && input.stream === "stale") {
    // The server moved to dropped after it served, and the follower found the operator still there: an outage, which its line says.
    return "outage";
  }
  return pauseStepsOnServer(input);
}

/** The steps once the console is on the server it will trade on: its verdict, then its prices, then the account and the market on screen. */
function pauseStepsOnServer(input: PauseInput): PauseShown {
  const { attestation } = input;
  const trusted = attestation.kind === "mock" || attestation.kind === "verified" || attestation.kind === "attested";
  const failed = { connect: "done", verify: "failed", prices: "waiting", resume: "waiting" } as const;
  if (attestation.kind === "unverified") return { steps: failed, failure: `${SERVER_REFUSED} ${STILL_PAUSED}` };
  // A clock the server disagrees with stops every answer until the trader corrects it, which nothing automatic does.
  if (attestation.kind === "clock") return { steps: failed, failure: CLOCK_FAILED };
  if (!trusted) return { steps: { ...NOT_YET, connect: "done", verify: "current" }, failure: null };
  if (input.stream !== "live" || !input.marketsRead || !input.flowing) return { steps: { connect: "done", verify: "done", prices: "current", resume: "waiting" }, failure: null };
  return { steps: { connect: "done", verify: "done", prices: "done", resume: input.ready ? "done" : "current" }, failure: null };
}

/**
 * Whether the server `state` reads prices its markets again: an open market has a live price, or none can have one, every open market
 * being without a feed here, or the market on screen cannot have one for a reason of its own, closed or without a feed.
 */
export function pricesFlow(state: ConsoleState): boolean {
  const open = state.markets.filter((m) => m.open);
  const shown = state.markets.find((m) => m.id === state.selected);
  return open.some(isPriced) || open.every((m) => isUnfed(m.view.pricing)) || (shown !== undefined && (!shown.open || isUnfed(shown.view.pricing)));
}

/**
 * Whether trading can resume on the server `state` reads: the connected account has been read, and the market on screen has a live price,
 * or cannot have one for a reason of its own (closed, or no feed prices it), or another open market has one, so prices flow and the
 * market's own outage is the server's to explain. A server that has just taken over may hold every market unpriced for a while, which
 * `PRICE_WAIT_MS` bounds; nothing here waits on the chart's history.
 */
export function readyToTrade(state: ConsoleState): boolean {
  if (state.wallet !== null && !state.accountRead) return false;
  const market = state.markets.find((m) => m.id === state.selected);
  if (market === undefined || !market.open || isPriced(market) || isUnfed(market.view.pricing)) return true;
  return state.markets.some((other) => other.open && isPriced(other));
}

/** What the pause watch reads from the session: the follower, and the store in use, which a move replaces. */
interface Source {
  subscribe(listener: () => void): () => void;
}

/** Watches the follower and the store in use for a pause, its steps and its resume, across the moves the session makes. */
export class TradingPause {
  private view: PauseView = { kind: "none" };
  private readonly listeners = new Set<() => void>();
  private store: (Source & { getSnapshot(): ConsoleState }) | null = null;
  private stopStore: (() => void) | null = null;
  /** The store the pause began on, so a move since is told from staying; null with no pause. */
  private startStore: unknown = null;
  /** Whether trading was live on any store this visit: a move before it, from a server that never served the page, pauses nothing. */
  private wasLive = false;
  private long: unknown = null;
  private leave: unknown = null;
  /** Bounds the wait for a price once the server has taken over (`PRICE_WAIT_MS`). */
  private priceWait: unknown = null;
  /** Where focus was when the pause began (`place`, null when on nothing named), which the page restores once the view is enabled again; null with nothing to restore. */
  private focusBefore: { place: FocusPlace | null } | null = null;
  private pane: string | null = null;
  private paneChosen: string | null = null;

  constructor(private readonly follower: Source & { getSnapshot(): FollowStatus }, private readonly scheduler: Scheduler) {
    follower.subscribe(this.update);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): PauseView => this.view;

  /** The store in use from now: the first, or the one a move brought. */
  use(store: Source & { getSnapshot(): ConsoleState }): void {
    this.stopStore?.();
    this.store = store;
    this.stopStore = store.subscribe(this.update);
    this.update();
  }

  /** Keeps where focus was as a pause begins, unless it is kept already for this pause: the first is where the trader was. */
  holdFocus(place: FocusPlace | null): void {
    this.focusBefore ??= { place };
  }

  /** The phone pane the trading view shows now, which a move's remount during a pause shows again; one chosen during the pause wins. */
  notePane(pane: string): void {
    if (this.view.kind !== "none" && pane !== this.pane) this.paneChosen = pane;
    this.pane = pane;
  }

  /** During a pause, a pane chosen in it, else the pane focus was in when it began, else the one shown; null with no pause. */
  heldPane(): string | null {
    return this.view.kind === "none" ? null : (this.paneChosen ?? this.focusBefore?.place?.pane ?? this.pane);
  }

  /** Where focus was when the pause began, given once after it ends: the view enabled again puts it back. */
  takeFocus(): { place: FocusPlace | null } | null {
    const place = this.focusBefore;
    this.focusBefore = null;
    return place;
  }

  private set(view: PauseView): void {
    this.view = view;
    for (const listener of this.listeners) listener();
  }

  private readonly update = (): void => {
    const state = this.store?.getSnapshot();
    if (state === undefined) return;
    const follow = this.follower.getSnapshot();
    if (state.stream === "live") this.wasLive = true;
    // A server that still serves still trades: the pause waits for it to stop, or for a drop at a boundary; a store a move has just brought,
    // not yet connected, is no stop, as the server moved away from was serving.
    const stopped = state.stream === "stale" || follow.kind === "confirming";
    if (pauses(follow) && this.wasLive && stopped && this.view.kind !== "paused") this.begin();
    if (this.view.kind !== "paused") return;
    const steps = pauseSteps({ follow, moved: this.startStore !== this.store, stream: state.stream, attestation: state.attestation, marketsRead: state.markets.length > 0, flowing: pricesFlow(state), ready: readyToTrade(state) });
    if (steps === "outage" || steps === "serving") return this.end();
    if (Object.values(steps.steps).every((step) => step === "done")) return this.resumed();
    this.waitForPrices(steps.steps.verify === "done" && state.stream === "live");
    const { view } = this;
    if (view.kind !== "paused") return;
    // Unchanged steps publish nothing: the store changes many times a second.
    const hold = steps.hold ?? null;
    const same = view.failure === steps.failure && view.hold === hold && STEP_ORDER.every((step) => view.steps[step] === steps.steps[step]);
    if (!same) this.set({ kind: "paused", steps: steps.steps, long: view.long, failure: steps.failure, hold });
  };

  /** While a server that has taken over streams and is trusted but its prices have not come, the wait is bounded; otherwise it is not. */
  private waitForPrices(waiting: boolean): void {
    if (!waiting) {
      if (this.priceWait !== null) this.scheduler.clearTimeout(this.priceWait);
      this.priceWait = null;
      return;
    }
    this.priceWait ??= this.scheduler.setTimeout(() => {
      this.priceWait = null;
      if (this.view.kind === "paused") this.end();
    }, PRICE_WAIT_MS);
  }

  private begin(): void {
    this.clearTimers();
    this.startStore = this.store;
    this.focusBefore = this.paneChosen = null; // what an earlier pause kept, which nothing took, is not this one's
    this.set({ kind: "paused", steps: NOT_YET, long: false, failure: null, hold: null });
    this.long = this.scheduler.setTimeout(() => {
      this.long = null;
      if (this.view.kind === "paused") this.set({ ...this.view, long: true });
    }, LONG_PAUSE_MS);
  }

  /** Trading resumed: said for a moment, then the panel leaves and the view is enabled again. */
  private resumed(): void {
    this.clearTimers();
    this.startStore = null;
    this.set({ kind: "resumed", leaving: false });
    this.leave = this.scheduler.setTimeout(() => {
      this.set({ kind: "resumed", leaving: true });
      this.leave = this.scheduler.setTimeout(() => {
        this.leave = null;
        this.set({ kind: "none" });
      }, LEAVE_MS);
    }, RESUMED_MS);
  }

  private end(): void {
    this.clearTimers();
    this.startStore = null;
    this.set({ kind: "none" });
  }

  private clearTimers(): void {
    for (const timer of [this.long, this.leave, this.priceWait]) if (timer !== null) this.scheduler.clearTimeout(timer);
    this.long = this.leave = this.priceWait = null;
  }
}
