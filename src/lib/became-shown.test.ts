import { describe, expect, it } from "vitest";

import { onBecomingShown } from "./became-shown";

/** A surface that is shown or hidden, and the `check` its changes call. */
function surface(shown: boolean) {
  const state = { shown, checks: [] as (() => void)[], stopped: 0, asked: 0 };
  const stop = onBecomingShown(() => state.shown, (check) => { state.checks.push(check); return () => { state.stopped += 1; }; }, () => { state.asked += 1; });
  const change = (now: boolean) => { state.shown = now; state.checks.forEach((check) => check()); };
  return { state, change, stop };
}

describe("onBecomingShown", () => {
  it("asks once when a hidden surface is shown, with nothing else changed", () => {
    const { state, change } = surface(false);
    change(false);
    expect(state.asked).toBe(0);
    change(true);
    expect(state.asked).toBe(1);
  });

  it("does not ask while the surface stays shown, or when it was shown from the start", () => {
    const { state, change } = surface(true);
    change(true);
    change(true);
    expect(state.asked).toBe(0);
  });

  it("asks again each time the surface is hidden and shown again", () => {
    const { state, change } = surface(false);
    change(true);
    change(false);
    change(true);
    expect(state.asked).toBe(2);
  });

  it("stops watching when stopped", () => {
    const { state, stop } = surface(false);
    stop();
    expect(state.stopped).toBe(1);
  });
});
