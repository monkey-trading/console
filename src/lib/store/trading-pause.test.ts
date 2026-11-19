/** Tests for trading paused while the trading server changes: when a pause begins, each step from what the console observes, and the resume. */

import { describe, expect, it } from "vitest";

import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { FollowStatus } from "../engine/operator-follow-status";
import { FakeScheduler } from "../engine/test-kit";
import type { ConsoleState } from "./state";
import { LEAVE_MS, LONG_PAUSE_MS, pauseSteps, PRICE_WAIT_MS, readyToTrade, RESUMED_MS, TradingPause, type PauseInput } from "./trading-pause";

const A = "https://a.test";
const B = "https://b.test";
const MOCK: AttestationStatus = { kind: "mock" };

/** A market as the pause reads it: open or not, and priced or not by the server's word. */
const market = (id: number, open: boolean, priced: boolean) => ({ id, open, mark: priced ? 1n : null, view: { pricing: { priced, min_sources: 1, sources: [{ state: priced ? "fresh" : "stale" }] } } });
/** The state the pause reads; the rest of `ConsoleState` it never touches. */
const state = (partial: { stream?: FeedStatus; attestation?: AttestationStatus; markets?: ReturnType<typeof market>[]; selected?: number; accountRead?: boolean }): ConsoleState =>
  ({ stream: "live", attestation: MOCK, markets: [market(1, true, true)], selected: 1, wallet: { address: "0xa" }, accountRead: true, ...partial }) as unknown as ConsoleState;

const input = (partial: Partial<PauseInput>): PauseInput => ({ follow: { kind: "following", origin: A }, moved: false, stream: "live", attestation: MOCK, marketsRead: true, flowing: true, ready: true, ...partial });

describe("pauseSteps", () => {
  it("shows the first step under way from a drop at a boundary, and as the next server has not answered", () => {
    for (const follow of [{ kind: "confirming", origin: A, scheduled: true }, { kind: "waiting", origin: A, target: B, stage: "connecting", reason: null }] as const) {
      expect(pauseSteps(input({ follow, stream: "stale" }))).toEqual({ steps: { connect: "current", verify: "waiting", prices: "waiting", resume: "waiting" }, failure: null });
    }
  });

  it("verifies once the next server answered, and fails that step in two sentences, with no chain of reasons, when it does not verify", () => {
    expect(pauseSteps(input({ follow: { kind: "waiting", origin: A, target: B, stage: "verifying", reason: null } }))).toMatchObject({ steps: { connect: "done", verify: "current", prices: "waiting" } });
    const refused = pauseSteps(input({ follow: { kind: "waiting", origin: A, target: B, stage: "refused", reason: "The server's signing key does not match the signing key that the vault uses." } }));
    expect(refused).toEqual({
      steps: { connect: "done", verify: "failed", prices: "waiting", resume: "waiting" },
      failure: "The next trading server could not be verified, so the app has not connected to it. Trading remains paused, and the app will try again automatically.",
    });
  });

  it("fails the first step for a next server this version of the app does not list", () => {
    expect(pauseSteps(input({ follow: { kind: "unlisted", origin: A, hostname: "c.test" } }))).toMatchObject({ steps: { connect: "failed" }, failure: expect.stringContaining("Reload the page") });
  });

  it("restores prices once moved until the new stream is live and its markets read, then resumes once the market on screen can trade", () => {
    const moved = { follow: { kind: "following", origin: B } as FollowStatus, moved: true };
    expect(pauseSteps(input({ ...moved, stream: "connecting" }))).toMatchObject({ steps: { verify: "done", prices: "current", resume: "waiting" } });
    expect(pauseSteps(input({ ...moved, marketsRead: false }))).toMatchObject({ steps: { prices: "current" } });
    expect(pauseSteps(input({ ...moved, ready: false }))).toMatchObject({ steps: { prices: "done", resume: "current" } });
    expect(pauseSteps(input({ ...moved }))).toEqual({ steps: { connect: "done", verify: "done", prices: "done", resume: "done" }, failure: null });
  });

  it("fails verification on the server moved to when its own check refuses it", () => {
    expect(pauseSteps(input({ follow: { kind: "following", origin: B }, moved: true, attestation: { kind: "unverified", reason: "refused" } }))).toMatchObject({ steps: { verify: "failed" }, failure: "The trading server could not be verified. Trading remains paused, and the app will try again automatically." });
  });

  it("calls a drop an outage once the follower finds the operator where it was and the stream is still down, and resumes if it came back", () => {
    for (const follow of [{ kind: "following", origin: A }, { kind: "pinned", origin: A }, { kind: "failed", origin: A, reason: "r" }] as const) {
      expect(pauseSteps(input({ follow, stream: "stale" }))).toBe("outage");
      expect(pauseSteps(input({ follow }))).toMatchObject({ steps: { resume: "done" } });
    }
  });
});

describe("readyToTrade", () => {
  it("waits for a price in the market on screen while no market has one, as on a server that has just taken over", () => {
    expect(readyToTrade(state({ markets: [market(1, true, false), market(2, true, false)] }))).toBe(false);
    expect(readyToTrade(state({ markets: [market(1, true, true)] }))).toBe(true);
  });

  it("does not wait on a market that cannot trade for a reason of its own, or whose own outage the server explains while others are priced", () => {
    expect(readyToTrade(state({ markets: [market(1, false, false)] }))).toBe(true);
    expect(readyToTrade(state({ markets: [market(1, true, false), market(2, true, true)] }))).toBe(true);
    expect(readyToTrade(state({ markets: [market(1, true, false), market(2, false, true)] }))).toBe(false);
  });
});

/** A source whose snapshot a test sets, telling its listeners. */
function source<T>(initial: T) {
  const listeners = new Set<() => void>();
  const held = { value: initial };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); },
    getSnapshot: () => held.value,
    set: (next: T) => { held.value = next; for (const listener of listeners) listener(); },
  };
}

/** A follower and a store whose snapshots a test sets, under a pause watch. */
function sources() {
  const follower = source<FollowStatus>({ kind: "following", origin: A });
  const scheduler = new FakeScheduler();
  const pause = new TradingPause(follower, scheduler);
  const store = source(state({}));
  pause.use(store);
  return { follower, store, scheduler, pause };
}

describe("TradingPause", () => {
  it("pauses on a drop at a boundary, moves through each step as the console observes it, says trading resumed, then leaves", () => {
    const { follower, store, scheduler, pause } = sources();
    follower.set({ kind: "confirming", origin: A, scheduled: true });
    expect(pause.getSnapshot()).toMatchObject({ kind: "paused", steps: { connect: "current" } });
    follower.set({ kind: "waiting", origin: A, target: B, stage: "verifying", reason: null });
    expect(pause.getSnapshot()).toMatchObject({ steps: { connect: "done", verify: "current" } });
    // The move brings a fresh store before the follower says it settled there.
    const next = source(state({ stream: "connecting" }));
    pause.use(next);
    follower.set({ kind: "following", origin: B });
    expect(pause.getSnapshot()).toMatchObject({ steps: { verify: "done", prices: "current" } });
    store.set(state({ stream: "stale" })); // the store left behind says nothing any more
    expect(pause.getSnapshot()).toMatchObject({ steps: { prices: "current" } });
    next.set(state({ markets: [market(1, true, false)] }));
    expect(pause.getSnapshot()).toMatchObject({ steps: { prices: "current", resume: "waiting" } });
    next.set(state({ accountRead: false }));
    expect(pause.getSnapshot()).toMatchObject({ steps: { prices: "done", resume: "current" } });
    next.set(state({}));
    expect(pause.getSnapshot()).toEqual({ kind: "resumed", leaving: false });
    scheduler.advance(RESUMED_MS);
    expect(pause.getSnapshot()).toEqual({ kind: "resumed", leaving: true });
    scheduler.advance(LEAVE_MS);
    expect(pause.getSnapshot()).toEqual({ kind: "none" });
  });

  it("does not pause on a drop away from a boundary, nor on a move before trading was ever live, as on a page load", () => {
    const { follower, pause } = sources();
    follower.set({ kind: "confirming", origin: A, scheduled: false });
    expect(pause.getSnapshot().kind).toBe("none");
    const fresh = new TradingPause(follower, new FakeScheduler());
    fresh.use(source(state({ stream: "connecting" })));
    follower.set({ kind: "waiting", origin: A, target: B, stage: "connecting", reason: null });
    expect(fresh.getSnapshot().kind).toBe("none");
  });

  it("ends with no resume when the follower calls the drop an outage, so the outage line can say so", () => {
    const { follower, store, pause } = sources();
    follower.set({ kind: "confirming", origin: A, scheduled: true });
    store.set(state({ stream: "stale" }));
    follower.set({ kind: "following", origin: A });
    expect(pause.getSnapshot()).toEqual({ kind: "none" });
  });

  it("says once the pause has run longer than usual, and not before", () => {
    const { follower, scheduler, pause } = sources();
    follower.set({ kind: "waiting", origin: A, target: B, stage: "connecting", reason: null });
    scheduler.advance(LONG_PAUSE_MS - 1);
    expect(pause.getSnapshot()).toMatchObject({ kind: "paused", long: false });
    scheduler.advance(1);
    expect(pause.getSnapshot()).toMatchObject({ kind: "paused", long: true });
  });

  it("ends with no resume when the server moved to drops after it served and the follower finds the operator still there", () => {
    const { follower, pause } = sources();
    follower.set({ kind: "waiting", origin: A, target: B, stage: "verifying", reason: null });
    const next = source(state({ stream: "connecting" }));
    pause.use(next);
    follower.set({ kind: "following", origin: B });
    expect(pause.getSnapshot()).toMatchObject({ kind: "paused", steps: { prices: "current" } });
    // A drop the follower is still reading keeps the pause; one it has read as an outage ends it.
    follower.set({ kind: "confirming", origin: B, scheduled: false });
    next.set(state({ stream: "stale" }));
    expect(pause.getSnapshot().kind).toBe("paused");
    follower.set({ kind: "following", origin: B });
    expect(pause.getSnapshot()).toEqual({ kind: "none" });
  });

  it("fails verification with what the trader must do when the device clock disagrees with the server moved to", () => {
    expect(pauseSteps(input({ follow: { kind: "following", origin: B }, moved: true, attestation: { kind: "clock", skewMs: 60_000 } }))).toMatchObject({ steps: { verify: "failed" }, failure: expect.stringContaining("Correct the clock and reload the page.") });
  });

  it("hands over to the server's own explanation when its prices do not come in time, and not before", () => {
    const { follower, scheduler, pause } = sources();
    follower.set({ kind: "waiting", origin: A, target: B, stage: "verifying", reason: null });
    pause.use(source(state({ markets: [market(1, true, false)] })));
    follower.set({ kind: "following", origin: B });
    expect(pause.getSnapshot()).toMatchObject({ kind: "paused", steps: { prices: "current" } });
    scheduler.advance(PRICE_WAIT_MS - 1);
    expect(pause.getSnapshot().kind).toBe("paused");
    scheduler.advance(1);
    expect(pause.getSnapshot()).toEqual({ kind: "none" });
  });

  it("publishes nothing when the store changes but the steps do not", () => {
    const { follower, store, pause } = sources();
    follower.set({ kind: "waiting", origin: A, target: B, stage: "connecting", reason: null });
    let published = 0;
    pause.subscribe(() => { published += 1; });
    store.set(state({ stream: "stale" }));
    store.set(state({ stream: "stale" }));
    expect(published).toBe(0);
  });
});

