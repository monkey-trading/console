/** Tests for what keeps the MONKEY page current by itself: which events re-read what, the once-a-second limit, the timers in a hidden tab, and a failing read's backoff. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamMessage } from "../engine/types";
import { Backoff, backoffMs, followLive, Limiter, rereadsFor, WALLET_READ_EVERY_MS, type LiveDeps } from "./live-reads";

const ME = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const message = (cmd: string, events: readonly { type: string; account?: string }[] = []) => ({ offset: "1:0", type: "command", seq: 1, ts: 0, cmd: { type: cmd }, events }) as unknown as StreamMessage;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("rereadsFor", () => {
  it("re-reads what a stake, an unstake, a delegation, an epoch, a distribution, an emission, a deposit, a claim, a key and a checkpoint change", () => {
    for (const cmd of ["stake_changed", "unstaked", "delegation", "close_epoch", "distribute", "emission_period_closed", "deposit", "claim", "register_session_key", "post_checkpoint"]) {
      expect(rereadsFor(message(cmd), ME).node, cmd).toBe(true);
    }
  });

  it("leaves a tick, a price, an order and the chain's progress reports alone, which run about once a second", () => {
    for (const cmd of ["tick", "prices", "place_order", "cancel_order", "staking_progress", "custody_finalised"]) expect(rereadsFor(message(cmd), ME)).toEqual({ node: false, wallet: false });
  });

  it("still reads what a progress report carries, such as a stake it mirrored", () => {
    expect(rereadsFor(message("staking_progress", [{ type: "staked", account: ME }]), ME)).toEqual({ node: true, wallet: true });
  });

  it("reads the wallet's own figures for its own events and for an epoch, a distribution or a checkpoint whoever it names, but not for another account's deposit", () => {
    expect(rereadsFor(message("deposit", [{ type: "deposited", account: ME.toUpperCase().replace("0X", "0x") }]), ME)).toEqual({ node: true, wallet: true });
    expect(rereadsFor(message("deposit", [{ type: "deposited", account: OTHER }]), ME)).toEqual({ node: true, wallet: false });
    expect(rereadsFor(message("close_epoch"), ME)).toEqual({ node: true, wallet: true });
    expect(rereadsFor(message("close_epoch"), null)).toEqual({ node: true, wallet: false });
  });
});

describe("Limiter", () => {
  it("runs the first call at once and folds the rest inside the second into one run at its end", async () => {
    const run = vi.fn();
    const limiter = new Limiter(run, 1000);
    limiter.call();
    expect(run).toHaveBeenCalledTimes(1);
    limiter.call();
    limiter.call();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs nothing once cancelled", async () => {
    const run = vi.fn();
    const limiter = new Limiter(run, 1000);
    limiter.call();
    limiter.call();
    limiter.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("backoff", () => {
  it("doubles from five seconds to a cap of two minutes, and is none after a success", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([0, 5000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
  });

  it("holds the timer back after each failure, and clears on a success", () => {
    const backoff = new Backoff();
    expect(backoff.ready(0)).toBe(true);
    backoff.record(true, 0);
    backoff.record(true, 0);
    expect(backoff.ready(9_999)).toBe(false);
    expect(backoff.ready(10_000)).toBe(true);
    backoff.record(false, 20_000);
    expect(backoff.ready(20_000)).toBe(true);
  });
});

describe("followLive", () => {
  function setup(over: Partial<LiveDeps> = {}) {
    let hidden = false;
    let listener: (m: StreamMessage) => void = () => {};
    const calls = { node: 0, wallet: 0, charts: 0 };
    const stop = followLive({
      isHidden: () => hidden, open: () => true, account: () => ME,
      subscribe: (on) => { listener = on; return () => { listener = () => {}; }; },
      readNode: () => { calls.node += 1; }, readWallet: () => { calls.wallet += 1; }, nodeDue: () => true, walletDue: () => true,
      tickCharts: () => { calls.charts += 1; }, tickMs: 5_000, nodeEveryMs: 30_000, ...over,
    });
    return { calls, stop, hide: (h: boolean) => { hidden = h; }, emit: (m: StreamMessage) => listener(m) };
  }

  it("reads the charts every five seconds, the node every thirty and the wallet every fifteen, and nothing once stopped", async () => {
    const { calls, stop } = setup();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toEqual({ node: 1, wallet: 2, charts: 6 });
    expect(WALLET_READ_EVERY_MS).toBe(15_000);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual({ node: 1, wallet: 2, charts: 6 });
  });

  it("reads nothing at all in a hidden tab, timers and events alike", async () => {
    const { calls, hide, emit } = setup();
    hide(true);
    await vi.advanceTimersByTimeAsync(120_000);
    emit(message("close_epoch"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual({ node: 0, wallet: 0, charts: 0 });
  });

  it("re-reads a panel straight away on an event that changes it, at most once a second", async () => {
    const { calls, emit } = setup();
    emit(message("stake_changed", [{ type: "staked", account: ME }]));
    expect(calls).toMatchObject({ node: 1, wallet: 1 });
    emit(message("stake_changed", [{ type: "staked", account: ME }]));
    emit(message("distribute"));
    expect(calls).toMatchObject({ node: 1, wallet: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toMatchObject({ node: 2, wallet: 2 });
    emit(message("tick"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toMatchObject({ node: 2, wallet: 2 });
  });

  it("skips a timed read that is still backing off, and the wallet's when there is no wallet", async () => {
    const { calls } = setup({ nodeDue: () => false, walletDue: () => false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toMatchObject({ node: 0, wallet: 0, charts: 6 });
    const none = setup({ account: () => null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(none.calls.wallet).toBe(0);
  });
});
