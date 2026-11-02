/** Tests for which setup steps remain and what a screen waits on. */

import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { currentStep, revokeClears, setupGate, setupSteps, stepNumber, type SetupFacts, type SetupStep, type SetupView } from "./setup-steps";

const FRESH: SetupFacts = { faucet: true, fund: null, walletHolds: null, credited: false, declared: null, keyUntil: null, deposit: null };
const names = (facts: SetupFacts) => setupSteps(facts).map((s) => s.step);
const doneOf = (facts: SetupFacts) => setupSteps(facts).filter((s) => s.done).map((s) => s.step);
const at = (facts: SetupFacts, step: SetupStep) => setupSteps(facts).find((s) => s.step === step);

describe("setupSteps", () => {
  it("lists every step in order from start to finish: fund, declare, authorize, deposit", () => {
    expect(names(FRESH)).toEqual(["fund", "declare", "authorize", "deposit"]);
    expect(doneOf(FRESH)).toEqual([]);
    expect(currentStep(setupSteps(FRESH))).toBe("fund");
  });

  it("has no faucet step outside a dev build, and keeps the rest", () => {
    expect(names({ ...FRESH, faucet: false })).toEqual(["declare", "authorize", "deposit"]);
  });

  it("keeps a finished step listed, done, and moves the current one on", () => {
    const facts = { ...FRESH, fund: "skipped" as const, declared: "professional" as const };
    expect(names(facts)).toEqual(["fund", "declare", "authorize", "deposit"]);
    expect(doneOf(facts)).toEqual(["fund", "declare"]);
    expect(currentStep(setupSteps(facts))).toBe("authorize");
  });

  it("summarises what the connection did: minted or skipped, the class, the key's expiry, the deposit", () => {
    const done: SetupFacts = { ...FRESH, fund: "minted", declared: "eligible_client", keyUntil: Date.UTC(2026, 10, 3, 16, 30), deposit: { amount: fixedFromInt(1000), credited: true } };
    expect(setupSteps(done).map((s) => s.summary)).toEqual(["10,000 USDC minted", "Eligible client", "This browser can trade until 3 Nov 16:30:00 UTC", "1,000 USDC deposited"]);
    expect(at({ ...done, fund: "skipped" }, "fund")?.summary).toBe("Skipped");
    expect(at({ ...done, declared: "professional" }, "declare")?.summary).toBe("Professional client");
    expect(currentStep(setupSteps(done))).toBeNull();
  });

  it("starts a wallet that already holds USDC with the fund step done, saying what it holds", () => {
    expect(at({ ...FRESH, walletHolds: fixedFromInt(2500) }, "fund")).toEqual({ step: "fund", done: true, summary: "Wallet holds 2,500 USDC" });
    expect(at({ ...FRESH, walletHolds: 0n }, "fund")?.done).toBe(false);
  });

  it("keeps a step done before this connection generic, since it has no detail to show", () => {
    expect(at({ ...FRESH, credited: true }, "fund")).toEqual({ step: "fund", done: true, summary: "Account already funded" });
    expect(at({ ...FRESH, faucet: false, credited: true }, "deposit")).toEqual({ step: "deposit", done: true, summary: "Account funded" });
  });

  it("leaves the deposit open while the one the wallet sent is not yet credited, and done when it is", () => {
    const sent = { amount: fixedFromInt(500), credited: false };
    expect(at({ ...FRESH, credited: true, deposit: sent }, "deposit")?.done).toBe(false);
    expect(at({ ...FRESH, deposit: { ...sent, credited: true } }, "deposit")).toEqual({ step: "deposit", done: true, summary: "500 USDC deposited" });
  });
});

describe("stepNumber", () => {
  it("numbers a step among the steps the build has, whichever are done", () => {
    expect((["fund", "declare", "authorize", "deposit"] as const).map((s) => stepNumber(s, true))).toEqual([1, 2, 3, 4]);
    expect((["declare", "authorize", "deposit"] as const).map((s) => stepNumber(s, false))).toEqual([1, 2, 3]);
  });
});

describe("setupGate", () => {
  const READY: SetupView = { wallet: {}, accountRead: true, eligibility: "professional", setup: { decided: true } };

  it("waits on nothing with a declaration", () => {
    expect(setupGate(READY)).toBeNull();
  });

  it("asks nothing of a visitor with no wallet, or of a read-only account", () => {
    expect(setupGate({ ...READY, wallet: null, eligibility: null })).toBeNull();
    expect(setupGate({ ...READY, wallet: { readOnly: true }, eligibility: null })).toBeNull();
  });

  it("says reading, and never needed, before the account has been read: a declared account never shows a step it has done", () => {
    expect(setupGate({ ...READY, accountRead: false, eligibility: null })).toBe("reading");
  });

  it("needs setup with no declaration alone: a declared wallet never waits on its key, whatever it holds", () => {
    expect(setupGate({ ...READY, eligibility: null })).toBe("needed");
    expect(setupGate({ ...READY, eligibility: "eligible_client" })).toBeNull();
  });

  it("says nothing of a page's starting demo account, read but not yet connected", () => {
    expect(setupGate({ ...READY, eligibility: null, setup: { decided: false } })).toBeNull();
  });
});

describe("revokeClears", () => {
  it("is true for the live-key cap, and false for the budget of new keys and any other refusal", () => {
    expect(revokeClears({ kind: "too_many_session_keys", max: 10 })).toBe(true);
    expect(revokeClears({ kind: "too_many_session_keys", max: 100 })).toBe(false);
    expect(revokeClears({ kind: "session_key_unsupported" })).toBe(false);
  });
});
