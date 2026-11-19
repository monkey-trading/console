/** Tests for what the polite live region says as trading pauses, moves through its steps, fails, runs long and resumes. */

import { describe, expect, it } from "vitest";

import type { PauseView, Steps } from "./store/trading-pause";
import { LONG_PAUSE, pauseAnnouncement, PAUSE_TITLE } from "./trading-pause-words";

const at = (steps: Partial<Steps>): Extract<PauseView, { kind: "paused" }> => ({ kind: "paused", steps: { connect: "done", verify: "done", prices: "done", resume: "done", ...steps }, long: false, failure: null, hold: null });

describe("pauseAnnouncement", () => {
  it("names the pause with its first step, then each step alone, then the resume", () => {
    expect(pauseAnnouncement(at({ connect: "current", verify: "waiting", prices: "waiting", resume: "waiting" }))).toBe(`${PAUSE_TITLE}. Connecting to the next trading server.`);
    expect(pauseAnnouncement(at({ verify: "current", prices: "waiting", resume: "waiting" }))).toBe("Verifying the trading server.");
    expect(pauseAnnouncement(at({ prices: "current", resume: "waiting" }))).toBe("Restoring live prices.");
    expect(pauseAnnouncement(at({ resume: "current" }))).toBe("Resuming trading.");
    expect(pauseAnnouncement({ kind: "resumed", leaving: false })).toBe("Trading resumed.");
    expect(pauseAnnouncement({ kind: "none" })).toBe("");
  });

  it("says why a step failed, or that the pause runs long, in place of the step", () => {
    expect(pauseAnnouncement({ ...at({ verify: "failed" }), failure: "It failed." })).toBe("It failed.");
    expect(pauseAnnouncement({ ...at({ prices: "current", resume: "waiting" }), long: true })).toBe(`${LONG_PAUSE} Restoring live prices.`);
  });
});
