import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmWindow } from "./confirm-window";
import type { Scheduler } from "./engine/live-stream";

const scheduler: Scheduler = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the confirm window", () => {
  it("is armed by the first press and lapses after exactly its window", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    window5.arm();
    expect(window5.isArmed()).toBe(true);
    vi.advanceTimersByTime(4_999);
    expect(window5.isArmed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(window5.isArmed()).toBe(false);
  });

  it("starts over on a press after it lapsed", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    window5.arm();
    vi.advanceTimersByTime(5_000);
    window5.arm();
    expect(window5.isArmed()).toBe(true);
    vi.advanceTimersByTime(4_999);
    expect(window5.isArmed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(window5.isArmed()).toBe(false);
  });

  it("keeps its original end when armed again inside the window", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    window5.arm();
    vi.advanceTimersByTime(3_000);
    window5.arm();
    vi.advanceTimersByTime(2_000);
    expect(window5.isArmed()).toBe(false);
  });

  it("tells its listeners when it arms and when it lapses, and not after they unsubscribe", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    const seen: boolean[] = [];
    const stop = window5.subscribe(() => seen.push(window5.isArmed()));
    window5.arm();
    vi.advanceTimersByTime(5_000);
    expect(seen).toEqual([true, false]);
    stop();
    window5.arm();
    expect(seen).toEqual([true, false]);
  });

  it("cancels: no timer is left running, and a later press arms a fresh full window", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    window5.arm();
    window5.cancel();
    expect(window5.isArmed()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    window5.arm();
    vi.advanceTimersByTime(4_999);
    expect(window5.isArmed()).toBe(true);
  });

  it("survives a StrictMode remount: a cancel with nothing armed leaves no timer, and arming after it works", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    window5.cancel();
    window5.cancel();
    expect(vi.getTimerCount()).toBe(0);
    window5.arm();
    expect(vi.getTimerCount()).toBe(1);
    window5.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports where a press stands: idle, too soon after arming, then ready until the window ends", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    expect(window5.state()).toBe("idle");
    window5.arm();
    expect(window5.state()).toBe("early");
    vi.advanceTimersByTime(399);
    expect(window5.state()).toBe("early");
    vi.advanceTimersByTime(1);
    expect(window5.state()).toBe("ready");
    vi.advanceTimersByTime(4_599);
    expect(window5.state()).toBe("ready");
    vi.advanceTimersByTime(1);
    expect(window5.state()).toBe("idle");
  });

  it("is closed at a press past its deadline even when its timer callback has not run", () => {
    const window5 = new ConfirmWindow(scheduler, 5_000, 400, () => Date.now());
    window5.arm();
    // The clock moves on (a suspended tab, a stalled thread) without the timer being delivered.
    vi.setSystemTime(Date.now() + 6_000);
    expect(window5.isArmed()).toBe(true);
    expect(window5.state()).toBe("idle");
    expect(window5.isArmed()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
