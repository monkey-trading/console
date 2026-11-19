/**
 * Trading paused while the trading server changes: when a pause begins, the steps it goes through, each from something the console
 * observes, and when trading resumes. A pause begins once trading was live and the follower finds the operator moving to another
 * server (`waiting`, or `unlisted`), or the stream drops around a turn boundary at which the member changes (a scheduled `confirming`),
 * and it lasts across the move to a fresh store. A drop the follower calls an outage ends it with no resume, and the outage line says so.
 */

import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { FollowStatus } from "../engine/operator-follow-status";
import type { Scheduler } from "../engine/live-stream";
import { asSentence } from "../format";
import { isPriced, isUnfed } from "../unpriced";
import type { ConsoleState } from "./state";

export type PauseStep = "connect" | "verify" | "prices" | "resume";
/** Where focus was in the trading view when trading paused, told by what a trader sees of the control: no element survives a move. */
export interface FocusPlace {
  tag: string;
  name: string;
}
export type StepState = "done" | "current" | "waiting" | "failed";
export type Steps = Readonly<Record<PauseStep, StepState>>;

/** What the trading view shows: nothing; the pause, its steps, whether it runs long and why a step failed; or trading resumed, then leaving. */
export type PauseView =
  | { kind: "none" }
  | { kind: "paused"; steps: Steps; long: boolean; failure: string | null }
  | { kind: "resumed"; leaving: boolean };

/** What the steps are read from. */
export interface PauseInput {
  follow: FollowStatus;
  /** Whether the session moved to another server's store since the pause began. */
  moved: boolean;
  stream: FeedStatus;
  attestation: AttestationStatus;
  /** Whether the server's markets have been read. */
  marketsRead: boolean;
  /** Whether prices reach the market on screen again (`readyToTrade`). */
  ready: boolean;
}

/** How long a pause runs before it says it is taking longer than usual, in milliseconds: the successor serves within seconds of the drop, as measured on a local stack, so this is several times that. */
export const LONG_PAUSE_MS = 30_000;
/** How long "Trading resumed" shows before the panel leaves, and how long it takes to leave, in milliseconds. */
export const RESUMED_MS = 1_500;
export const LEAVE_MS = 300;

const NOT_YET: Steps = { connect: "waiting", verify: "waiting", prices: "waiting", resume: "waiting" };

/** Whether `follow` begins a pause: the operator moving to another server, or a drop held as one. */
export function pauses(follow: FollowStatus): boolean {
  return follow.kind === "waiting" || follow.kind === "unlisted" || (follow.kind === "confirming" && follow.scheduled);
}

/** The steps `input` shows and why one failed, or `outage` when the console stayed on its server and its stream is still down. */
export function pauseSteps(input: PauseInput): { steps: Steps; failure: string | null } | "outage" {
  const { follow, attestation } = input;
  const trusted = attestation.kind === "mock" || attestation.kind === "verified" || attestation.kind === "attested";
  // Until a move, or again when the server moved to is itself being left, the follower says how far the change has got.
  if (!input.moved || follow.kind === "waiting" || follow.kind === "unlisted") {
    switch (follow.kind) {
      case "confirming":
        return { steps: { ...NOT_YET, connect: "current" }, failure: null };
      case "unlisted":
        return { steps: { ...NOT_YET, connect: "failed" }, failure: "This version of the app does not recognise the next trading server, so it cannot connect to it. Trading remains paused. Reload the page to use the latest version of the app." };
      case "waiting":
        if (follow.stage === "connecting") return { steps: { ...NOT_YET, connect: "current" }, failure: null };
        if (follow.stage === "verifying") return { steps: { ...NOT_YET, connect: "done", verify: "current" }, failure: null };
        return { steps: { ...NOT_YET, connect: "done", verify: "failed" }, failure: refusal("The next trading server could not be verified, so the app has not connected to it.", follow.reason) };
      case "pinned":
      case "following":
      case "failed":
        // The console stayed where it was: its own stream coming back resumes trading, and one that stays down is an outage.
        if (input.stream !== "live") return "outage";
        break;
      default:
        return follow satisfies never;
    }
  }
  if (attestation.kind === "unverified") return { steps: { connect: "done", verify: "failed", prices: "waiting", resume: "waiting" }, failure: refusal("The trading server could not be verified.", attestation.reason) };
  if (!trusted) return { steps: { ...NOT_YET, connect: "done", verify: "current" }, failure: null };
  if (input.stream !== "live" || !input.marketsRead) return { steps: { connect: "done", verify: "done", prices: "current", resume: "waiting" }, failure: null };
  return { steps: { connect: "done", verify: "done", prices: "done", resume: input.ready ? "done" : "current" }, failure: null };
}

/** A failed step's words: what happened, that trading stays paused and is tried again, and why. */
function refusal(happened: string, reason: string | null): string {
  return `${happened} Trading remains paused, and the app will try again automatically.${reason === null ? "" : ` ${asSentence(reason)}`}`;
}

/**
 * Whether trading can resume on the server `state` reads: the market on screen has a live price, or cannot have one for a reason of its own
 * (closed, or no feed prices it), or another open market has one, so prices flow and the market's own outage is the server's to explain.
 * A server that has just taken over may hold every market unpriced for a while; nothing here waits on the chart's history.
 */
export function readyToTrade(state: ConsoleState): boolean {
  const market = state.markets.find((m) => m.id === state.selected);
  if (market === undefined || !market.open || isPriced(market) || isUnfed(market.view.pricing)) return true;
  return state.markets.some((other) => other.open && isPriced(other));
}

/** What the pause watch reads from the session: the follower, and the store in use, which a move replaces. */
interface Source {
  subscribe(listener: () => void): () => void;
}

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
  /** Where focus was in the trading view when the pause began, which the view restores once it is enabled again. */
  private focusBefore: FocusPlace | null = null;

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

  /** Keeps where focus was as a pause begins, unless a place is kept already: the first is where the trader was. */
  holdFocus(place: FocusPlace | null): void {
    this.focusBefore ??= place;
  }

  /** Where focus was when the pause began, given once: the view enabled again puts it back. */
  takeFocus(): FocusPlace | null {
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
    if (pauses(follow) && this.wasLive && this.view.kind !== "paused") this.begin();
    if (this.view.kind !== "paused") return;
    const steps = pauseSteps({ follow, moved: this.startStore !== this.store, stream: state.stream, attestation: state.attestation, marketsRead: state.markets.length > 0, ready: readyToTrade(state) });
    if (steps === "outage") return this.end();
    if (Object.values(steps.steps).every((step) => step === "done")) return this.resumed();
    this.set({ kind: "paused", steps: steps.steps, long: this.view.long, failure: steps.failure });
  };

  private begin(): void {
    this.clearTimers();
    this.startStore = this.store;
    this.set({ kind: "paused", steps: NOT_YET, long: false, failure: null });
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
    for (const timer of [this.long, this.leave]) if (timer !== null) this.scheduler.clearTimeout(timer);
    this.long = this.leave = null;
  }
}
