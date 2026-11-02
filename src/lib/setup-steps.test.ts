/** Tests for which setup steps remain and what a screen waits on. */

import { describe, expect, it } from "vitest";

import { revokeClears, setupGate, setupSteps, stepNumber, type SetupView } from "./setup-steps";

const FRESH = { faucet: true, credited: false, declared: false, keyed: false, fundSettled: false };

describe("setupSteps", () => {
  it("lists the steps in order: fund, declare, authorize", () => {
    expect(setupSteps(FRESH)).toEqual(["fund", "declare", "authorize"]);
  });

  it("offers the faucet only in a dev build, to a never-credited account, and until it is settled", () => {
    expect(setupSteps({ ...FRESH, faucet: false })).toEqual(["declare", "authorize"]);
    expect(setupSteps({ ...FRESH, credited: true })).toEqual(["declare", "authorize"]);
    expect(setupSteps({ ...FRESH, fundSettled: true })).toEqual(["declare", "authorize"]);
  });

  it("shows only the steps that remain", () => {
    expect(setupSteps({ ...FRESH, faucet: false, declared: true })).toEqual(["authorize"]);
    expect(setupSteps({ ...FRESH, faucet: false, keyed: true })).toEqual(["declare"]);
    expect(setupSteps({ faucet: false, credited: true, declared: true, keyed: true, fundSettled: false })).toEqual([]);
  });
});

describe("stepNumber", () => {
  it("numbers a step among the steps the build has, whichever remain", () => {
    expect(["fund", "declare", "authorize"].map((s) => stepNumber(s as "fund", true))).toEqual([1, 2, 3]);
    expect(["declare", "authorize"].map((s) => stepNumber(s as "declare", false))).toEqual([1, 2]);
  });
});

describe("setupGate", () => {
  const READY: SetupView = { wallet: {}, accountRead: true, eligibility: "professional", now: 100, sessionExpiresAt: 200, sessionRefusal: null, setup: { decided: true } };

  it("waits on nothing with a declaration and a live key", () => {
    expect(setupGate(READY)).toBeNull();
  });

  it("asks nothing of a visitor with no wallet, or of a read-only account", () => {
    expect(setupGate({ ...READY, wallet: null, eligibility: null })).toBeNull();
    expect(setupGate({ ...READY, wallet: { readOnly: true }, eligibility: null })).toBeNull();
  });

  it("says reading, and never needed, before the account has been read: a declared account never shows a step it has done", () => {
    expect(setupGate({ ...READY, accountRead: false, eligibility: null, sessionExpiresAt: 0 })).toBe("reading");
  });

  it("needs setup with no declaration, with no key, and with a key the clock has passed, at the exact instant", () => {
    expect(setupGate({ ...READY, eligibility: null })).toBe("needed");
    expect(setupGate({ ...READY, sessionExpiresAt: 0 })).toBe("needed");
    expect(setupGate({ ...READY, sessionExpiresAt: 100 })).toBe("needed");
    expect(setupGate({ ...READY, sessionExpiresAt: 101 })).toBeNull();
  });

  it("stops waiting on a key once the node has refused one, since the wallet then signs; a missing declaration still waits", () => {
    const refused = { ...READY, sessionExpiresAt: 0, sessionRefusal: { kind: "too_many_session_keys", max: 10 } as const };
    expect(setupGate(refused)).toBeNull();
    expect(setupGate({ ...refused, eligibility: null })).toBe("needed");
  });

  it("says nothing of a page's starting demo account, read but not yet connected", () => {
    expect(setupGate({ ...READY, sessionExpiresAt: 0, setup: { decided: false } })).toBeNull();
  });
});

describe("revokeClears", () => {
  it("is true for the live-key cap, and false for the budget of new keys and any other refusal", () => {
    expect(revokeClears({ kind: "too_many_session_keys", max: 10 })).toBe(true);
    expect(revokeClears({ kind: "too_many_session_keys", max: 100 })).toBe(false);
    expect(revokeClears({ kind: "session_key_unsupported" })).toBe(false);
  });
});
