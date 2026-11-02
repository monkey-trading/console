/** Tests for what a claim panel may say of a vault checkpoint that disagrees with the node's proof. */

import { describe, expect, it } from "vitest";

import { CHECK_GRACE_MS, disagrees, RECHECK_MS, verdict } from "./verdict";

describe("verdict", () => {
  it("shows a disagreement as checking until it has lasted the grace period, and then says it", () => {
    expect(verdict("waiting", false)).toBe("checking");
    expect(verdict("waiting", true)).toBe("waiting");
  });

  it("draws no verdict from a pair that has not landed, and leaves an agreement as it is", () => {
    expect(verdict("unknown", true)).toBe("unknown");
    expect(verdict("posted", false)).toBe("posted");
  });

  it("calls only a vault behind the proof a disagreement", () => {
    expect((["unknown", "posted", "waiting"] as const).map(disagrees)).toEqual([false, false, true]);
  });

  it("re-reads several times inside the grace period", () => {
    expect(CHECK_GRACE_MS / RECHECK_MS).toBeGreaterThanOrEqual(5);
  });
});
