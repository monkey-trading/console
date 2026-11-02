import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { ACCRUES, coverageNote, monkeyCell, NO_ALLOCATION, scheduleNotice } from "./ledger-cell";
import { monkey } from "./ledger-kit";
import type { LedgerTotals, Share } from "./ledger-share";

const totals = (monkeyShort: boolean): LedgerTotals => ({ realised: fixedFromInt(1), fees: 0n, monkey: 0n, monkeyShort });

describe("monkeyCell", () => {
  it("shows a share as a bare figure with the accrual tooltip", () => {
    expect(monkeyCell({ kind: "share", units: monkey(1_234n) + monkey(1n) / 2n }, "ready")).toEqual({ text: "1,234.5", title: ACCRUES });
  });

  it("shows nothing for a win", () => {
    expect(monkeyCell({ kind: "none" }, "ready")).toBeNull();
  });

  it("shows Pending, Loading and 0, each with its own tooltip, 0 giving the reasons a period allocates nothing", () => {
    expect(monkeyCell({ kind: "pending" }, "ready")?.text).toBe("Pending");
    expect(monkeyCell({ kind: "loading" }, "ready")?.text).toBe("Loading");
    expect(monkeyCell({ kind: "zero" }, "ready")).toEqual({ text: "0", title: NO_ALLOCATION });
    expect(NO_ALLOCATION).toMatch(/written off.*paid down.*negative/);
  });

  it("shows — for an unknown period and says why by what the schedule read did", () => {
    const unknown: Share = { kind: "unknown" };
    expect(monkeyCell(unknown, "unavailable")).toEqual({ text: "—", title: scheduleNotice("unavailable") });
    expect(monkeyCell(unknown, "failed")).toEqual({ text: "—", title: scheduleNotice("failed") });
    expect(scheduleNotice("unavailable")).not.toBe(scheduleNotice("failed"));
  });
});

describe("scheduleNotice", () => {
  it("is null for a schedule that was read or is yet to be", () => {
    expect(scheduleNotice("ready")).toBeNull();
    expect(scheduleNotice("idle")).toBeNull();
  });
});

describe("coverageNote", () => {
  it("says the totals cover the whole account only when nothing more can be read", () => {
    expect(coverageNote(7, totals(false), false, false)).toBe("Totals cover every realised result of this account.");
  });

  it("says the totals cover only what is loaded, with the singular for one result", () => {
    expect(coverageNote(1, totals(false), true, false)).toBe("Totals cover the 1 result loaded so far, not the whole history. Load more for older ones.");
    expect(coverageNote(1_500, totals(false), true, false)).toContain("the 1,500 results loaded");
  });

  it("names the bound, and does not offer Load more, when the ledger is full", () => {
    const note = coverageNote(2_000, totals(false), true, true);
    expect(note).toBe("Totals cover the 2,000 results loaded, the most the ledger holds; results not loaded are left out.");
  });

  it("adds that the MONKEY total leaves losses out while some share is not known", () => {
    expect(coverageNote(7, totals(true), false, false)).toContain("leaves out losses shown as Pending, Loading or —");
  });
});
