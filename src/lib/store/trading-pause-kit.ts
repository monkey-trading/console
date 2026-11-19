/** Tests only: the follower, store and inputs the pause watch reads, which a test sets. */

import type { AttestationStatus, FeedStatus } from "../engine/attestation";
import type { FollowStatus } from "../engine/operator-follow-status";
import { FakeScheduler } from "../engine/test-kit";
import type { ConsoleState } from "./state";
import { TradingPause, type PauseInput } from "./trading-pause";

export const A = "https://a.test";
export const B = "https://b.test";
export const MOCK: AttestationStatus = { kind: "mock" };

/** A market as the pause reads it: open or not, and priced or not by the server's word. */
export const market = (id: number, open: boolean, priced: boolean) => ({ id, open, mark: priced ? 1n : null, view: { pricing: { priced, min_sources: 1, sources: [{ state: priced ? "fresh" : "stale" }] } } });
/** The state the pause reads; the rest of `ConsoleState` it never touches. */
export const state = (partial: { stream?: FeedStatus; attestation?: AttestationStatus; markets?: ReturnType<typeof market>[]; selected?: number; accountRead?: boolean }): ConsoleState =>
  ({ stream: "live", attestation: MOCK, markets: [market(1, true, true)], selected: 1, wallet: { address: "0xa" }, accountRead: true, ...partial }) as unknown as ConsoleState;

export const input = (partial: Partial<PauseInput>): PauseInput => ({ follow: { kind: "following", origin: A }, moved: false, stream: "live", attestation: MOCK, marketsRead: true, flowing: true, ready: true, ...partial });

/** A source whose snapshot a test sets, telling its listeners. */
export function source<T>(initial: T) {
  const listeners = new Set<() => void>();
  const held = { value: initial };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); },
    getSnapshot: () => held.value,
    set: (next: T) => { held.value = next; for (const listener of listeners) listener(); },
  };
}

/** A follower and a store whose snapshots a test sets, under a pause watch. */
export function sources() {
  const follower = source<FollowStatus>({ kind: "following", origin: A });
  const scheduler = new FakeScheduler();
  const pause = new TradingPause(follower, scheduler);
  const store = source(state({}));
  pause.use(store);
  return { follower, store, scheduler, pause };
}
