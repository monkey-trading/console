/** Tests for what the polite live region says as trading pauses, moves through its steps, fails, runs long and resumes. */

import { describe, expect, it } from "vitest";

import { pauseLine, switchLine } from "./server-status";
import type { PauseView, Steps } from "./store/trading-pause";
import { LONG_PAUSE, pauseAnnouncement, PAUSE_TITLE } from "./trading-pause-words";

const at = (steps: Partial<Steps>): Extract<PauseView, { kind: "paused" }> => ({ kind: "paused", steps: { connect: "done", verify: "done", prices: "done", resume: "done", ...steps }, long: false, failure: null });

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

describe("the banner's lines for a change of server", () => {
  it("says on other pages that trading is paused, why a step failed, or that it runs long, and nothing once it resumed", () => {
    expect(pauseLine(at({ connect: "current" }))).toMatchObject({ role: "status", lead: `${PAUSE_TITLE}.` });
    expect(pauseLine({ ...at({ verify: "failed" }), failure: "It failed." })).toEqual({ role: "alert", lead: `${PAUSE_TITLE}.`, rest: "It failed." });
    expect(pauseLine({ ...at({ connect: "current" }), long: true })).toMatchObject({ rest: LONG_PAUSE });
    expect(pauseLine({ kind: "resumed", leaving: false })).toBeNull();
  });

  it("says a page load could not verify the current server with no chain of reasons, and is calm while it is checked", () => {
    expect(switchLine({ kind: "waiting", origin: "https://a.test", target: "https://b.test:8443", stage: "refused", reason: "not the vault's release" })).toEqual({
      role: "alert", lead: "The current trading server could not be verified, so the app has not connected to it.", rest: "The app will try again automatically.",
    });
    expect(switchLine({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null })).toMatchObject({ role: "status", lead: "Connecting to the current trading server." });
    expect(switchLine({ kind: "following", origin: "https://a.test" })).toBeNull();
  });
});
