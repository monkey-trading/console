/** Tests for the banner's one line while the trading server changes: on pages without the trading view, and while the console moves with its view not paused. */

import { describe, expect, it } from "vitest";

import { pauseLine, switchLine } from "./server-status";
import type { PauseView, Steps } from "./store/trading-pause";
import { CHAIN_UNREAD, CHAIN_UNREAD_FIX, CHAIN_UNREAD_LEAD, LONG_PAUSE, PAUSE_TITLE, RESUMES_WHEN, WALLET_HOLD } from "./trading-pause-words";

const at = (steps: Partial<Steps>): Extract<PauseView, { kind: "paused" }> => ({ kind: "paused", steps: { connect: "done", verify: "done", prices: "done", resume: "done", ...steps }, long: false, failure: null, hold: null });

describe("the banner's lines for a change of server", () => {
  it("says on other pages that trading is paused, why a step failed, or that it runs long, and nothing once it resumed", () => {
    expect(pauseLine(at({ connect: "current" }))).toMatchObject({ role: "status", lead: `${PAUSE_TITLE}.` });
    expect(pauseLine({ ...at({ verify: "failed" }), failure: "It failed." })).toEqual({ role: "alert", lead: `${PAUSE_TITLE}.`, rest: "It failed." });
    expect(pauseLine({ ...at({ connect: "current" }), long: true })).toMatchObject({ rest: LONG_PAUSE });
    expect(pauseLine(at({ connect: "current" }))).toMatchObject({ rest: RESUMES_WHEN });
    // What else holds the pause is said over how long it has run, as the panel says it.
    expect(pauseLine({ ...at({ prices: "current" }), long: true, hold: WALLET_HOLD })).toMatchObject({ role: "status", rest: WALLET_HOLD });
    expect(pauseLine({ ...at({ connect: "current" }), hold: CHAIN_UNREAD })).toMatchObject({ role: "status", rest: CHAIN_UNREAD });
    expect(pauseLine({ kind: "resumed", leaving: false })).toBeNull();
  });

  it("says a page load could not verify the current server with no chain of reasons, and is calm while it is checked", () => {
    expect(switchLine({ kind: "waiting", origin: "https://a.test", target: "https://b.test:8443", stage: "refused", reason: "not the vault's release" }, false)).toEqual({
      role: "alert", lead: "The current trading server could not be verified, so the app has not connected to it.", rest: "The app will try again automatically.",
    });
    expect(switchLine({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null }, false)).toMatchObject({ role: "status", lead: "Connecting to the current trading server." });
    expect(switchLine({ kind: "following", origin: "https://a.test" }, true)).toBeNull();
  });

  it("says while the server in use still trades that only new orders wait, and what the trader must do about a clock", () => {
    const waiting = (stage: "connecting" | "wallet" | "refused" | "clock" | "unread") => switchLine({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage, reason: null }, true);
    expect(waiting("connecting")).toEqual({ role: "status", lead: "The trading server is changing.", rest: "New orders are paused until the change is complete, but you can still close positions and cancel working orders." });
    expect(waiting("wallet")).toEqual({ role: "status", lead: "The trading server is changing.", rest: WALLET_HOLD });
    expect(switchLine({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "wallet", reason: null }, false)).toEqual({ role: "status", lead: "Connecting to the current trading server.", rest: WALLET_HOLD });
    expect(waiting("unread")).toEqual({ role: "status", lead: CHAIN_UNREAD_LEAD, rest: CHAIN_UNREAD_FIX });
    expect(waiting("refused")).toEqual({ role: "alert", lead: "The next trading server could not be verified, so the app has not connected to it.", rest: "New orders remain paused, and the app will try again automatically." });
    expect(waiting("clock")).toEqual({ role: "alert", lead: "Your device clock is incorrect, so the trading server cannot be verified.", rest: "Correct the clock and reload the page." });
  });
});
