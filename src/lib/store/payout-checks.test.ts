import { describe, expect, it } from "vitest";

import { fixedFromWire } from "../fixed";
import { AFTER_BOUNDARY_MS, checkReadDelay, MAX_DELAY_MS, earliestCheck, STILL_WAITING_MS, waitsForInstallation } from "./payout-checks";
import type { Payout, PayoutStatus } from "./payouts";

const payout = (nonce: number, status: PayoutStatus): Payout => ({ nonce, amount: fixedFromWire("10"), status, read: true });

describe("earliestCheck", () => {
  it("is the earliest boundary among the unsigned payouts that wait for a check, and null when none does", () => {
    expect(earliestCheck([payout(1, { kind: "waiting", checkAtMs: 900 }), payout(2, { kind: "waiting", checkAtMs: 500 }), payout(3, { kind: "waiting" }), payout(4, { kind: "paid" })])).toBe(500);
    expect(earliestCheck([payout(1, { kind: "waiting" }), payout(2, { kind: "expired", expiresAt: 5 })])).toBeNull();
    expect(earliestCheck([])).toBeNull();
  });
});

describe("checkReadDelay", () => {
  it("reads just after a boundary ahead, and at the slow pace once it has passed, whatever time it names", () => {
    expect(checkReadDelay(10_000, 4_000)).toBe(6_000 + AFTER_BOUNDARY_MS);
    expect(checkReadDelay(10_000, 10_000)).toBe(STILL_WAITING_MS);
    expect(checkReadDelay(10_000, 90_000)).toBe(STILL_WAITING_MS);
  });

  it("never waits longer than a day, whatever boundary the node names", () => {
    expect(checkReadDelay(10_000 * 86_400_000, 1)).toBe(MAX_DELAY_MS);
  });

  it("reads at the slow pace on a clock no frame has set yet, which would make any boundary look ahead", () => {
    expect(checkReadDelay(10_000, 0)).toBe(STILL_WAITING_MS);
  });
});

describe("waitsForInstallation", () => {
  it("is true only while an unsigned payout waits for an installation, which sets no boundary", () => {
    const installing = payout(1, { kind: "waiting", installation: true });
    expect(waitsForInstallation([payout(2, { kind: "waiting", checkAtMs: 500 }), installing])).toBe(true);
    expect(waitsForInstallation([payout(2, { kind: "waiting", checkAtMs: 500 }), payout(3, { kind: "waiting" })])).toBe(false);
    expect(earliestCheck([installing])).toBeNull();
  });
});
