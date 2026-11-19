/** Tests for a change of server while the server in use still serves, what else holds a pause, which market lets prices count, and where focus goes back. */

import { describe, expect, it } from "vitest";

import { CHAIN_UNREAD, WALLET_HOLD } from "../trading-pause-words";
import { pauseSteps, pricesFlow } from "./trading-pause";
import { A, B, input, market, source, sources, state } from "./trading-pause-kit";

const WAITING = { kind: "waiting", origin: A, target: B, stage: "connecting", reason: null } as const;

describe("a change of server while the server in use still serves", () => {
  it("leaves the view as it is while the server in use still trades, pauses once it stops, and ends with no resume if it serves again first", () => {
    const { follower, store, pause } = sources();
    const kinds: string[] = [];
    pause.subscribe(() => kinds.push(pause.getSnapshot().kind));
    follower.set(WAITING);
    expect(kinds).toEqual([]);
    store.set(state({ stream: "stale" }));
    expect(pause.getSnapshot()).toMatchObject({ kind: "paused", steps: { connect: "current" } });
    store.set(state({ stream: "live" }));
    expect(pause.getSnapshot()).toEqual({ kind: "none" });
  });

  it("does not pause on the move itself, while the store it brings has yet to connect, from a server that served until then", () => {
    const { follower, pause } = sources();
    follower.set(WAITING);
    pause.use(source(state({ stream: "connecting" })));
    expect(pause.getSnapshot()).toEqual({ kind: "none" });
  });

  it("says a request waiting in the wallet holds the move, and a clock the next server disagrees with fails verification", () => {
    expect(pauseSteps(input({ follow: { ...WAITING, stage: "wallet" }, stream: "stale" }))).toMatchObject({ steps: { verify: "done", prices: "current" }, hold: WALLET_HOLD });
    expect(pauseSteps(input({ follow: { ...WAITING, stage: "clock" }, stream: "stale" }))).toMatchObject({ steps: { verify: "failed" }, failure: expect.stringContaining("Correct the clock") });
  });

  it("says that a failed read of the blockchain through the wallet holds the move, in place of the wait for a server", () => {
    expect(pauseSteps(input({ follow: { ...WAITING, stage: "unread" }, stream: "stale" }))).toMatchObject({ steps: { connect: "current" }, failure: null, hold: CHAIN_UNREAD });
  });
});

describe("pricesFlow", () => {
  it("counts prices as flowing when the market on screen cannot have one for a reason of its own, however the others stand", () => {
    expect(pricesFlow(state({ markets: [market(1, false, false), market(2, true, false)] }))).toBe(true);
    expect(pricesFlow(state({ markets: [market(1, true, false), market(2, true, false)] }))).toBe(false);
    expect(pricesFlow(state({ markets: [market(1, true, false), market(2, true, true)] }))).toBe(true);
  });
});

describe("the focus a pause keeps", () => {
  it("keeps the first place of a pause, gives it once, never gives an earlier pause's, and carries the pane during the pause", () => {
    const { follower, store, pause } = sources();
    store.set(state({ stream: "stale" }));
    pause.notePane("account");
    follower.set(WAITING);
    pause.holdFocus({ tag: "INPUT", name: "Size (contracts)", pane: "trade" });
    pause.holdFocus({ tag: "BUTTON", name: "Close", pane: "account" });
    expect(pause.heldPane()).toBe("trade");
    expect(pause.takeFocus()).toEqual({ place: { tag: "INPUT", name: "Size (contracts)", pane: "trade" } });
    expect(pause.takeFocus()).toBeNull();
    // A pause whose place nobody took leaves nothing for the next.
    pause.holdFocus(null);
    store.set(state({ stream: "live" }));
    store.set(state({ stream: "stale" }));
    expect(pause.takeFocus()).toBeNull();
    expect(pause.heldPane()).toBe("account");
  });

  it("shows a pane the trader chose during the pause again after a move, over the pane focus was in", () => {
    const { follower, store, pause } = sources();
    pause.notePane("trade");
    follower.set(WAITING);
    store.set(state({ stream: "stale" }));
    pause.holdFocus({ tag: "INPUT", name: "Size (contracts)", pane: "trade" });
    pause.notePane("trade");
    expect(pause.heldPane()).toBe("trade");
    pause.notePane("chart");
    expect(pause.heldPane()).toBe("chart");
    // A later pause begins from what it finds, not from the pane chosen in this one.
    store.set(state({ stream: "live" }));
    follower.set({ kind: "following", origin: A });
    pause.notePane("account");
    follower.set(WAITING);
    store.set(state({ stream: "stale" }));
    expect(pause.heldPane()).toBe("account");
  });
});
