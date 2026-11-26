import { describe, expect, it } from "vitest";

import { fixedFromInt } from "./fixed";
import { ACCRUES, coverageNote, ledgerHeader, monkeyCell, NO_ALLOCATION, scheduleNotice, startNote } from "./ledger-cell";
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
    expect(NO_ALLOCATION).toMatch(/written off.*repaid.*negative/);
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

describe("startNote", () => {
  const START = Date.UTC(2026, 9, 26, 13, 52);
  const NOTE = "Realised results before 2026-10-26 13:52 UTC are not available here.";

  it("is shown with the rows held", () => {
    expect(startNote(START, 3, false)).toBe(NOTE);
    expect(startNote(START, 3, true)).toBe(NOTE);
  });

  it("is shown while older pages remain behind loaded rows that realise nothing", () => {
    expect(startNote(START, 0, true)).toBe(NOTE);
  });

  it("is left to the empty state when nothing is held and nothing remains, and absent while no page states a start", () => {
    expect(startNote(START, 0, false)).toBeNull();
    expect(startNote(null, 3, true)).toBeNull();
  });
});

describe("coverageNote", () => {
  it("says the totals cover the whole account only when nothing more can be read", () => {
    expect(coverageNote(7, totals(false), false, false)).toBe("The totals cover all of your realised results.");
  });

  it("names where the results begin once the server states it, so the totals are not read as all-time", () => {
    expect(coverageNote(7, totals(false), false, false, Date.UTC(2026, 9, 26, 13, 52))).toBe("The totals cover all of your realised results since 2026-10-26 13:52 UTC.");
  });

  it("says the totals cover only what is loaded, with the singular for one result", () => {
    expect(coverageNote(1, totals(false), true, false)).toBe("The totals cover the 1 result loaded so far. Select Load more to include older results.");
    expect(coverageNote(1_500, totals(false), true, false)).toContain("the 1,500 results loaded");
  });

  it("names the bound, and does not offer Load more, when the ledger is full", () => {
    const note = coverageNote(2_000, totals(false), true, true);
    expect(note).toBe("The totals cover the 2,000 results loaded, which is the maximum this list can hold. Older results are not included.");
  });

  it("adds that the MONKEY total leaves losses out while some share is not known", () => {
    expect(coverageNote(7, totals(true), false, false)).toContain("excludes losses shown as Pending, Loading or —");
  });
});

describe("ledgerHeader", () => {
  const note = coverageNote(300, totals(false), true, false);

  it("gives the error together with the coverage note when a Load more failed, so the totals stay qualified", () => {
    const header = ledgerHeader({ status: "ready", error: "The node did not answer.", scheduleStatus: "ready" }, 300, totals(false), true, false);
    expect(header).toEqual({ blank: false, status: `The node did not answer. ${note}` });
  });

  it("gives the coverage note alone, with the schedule's notice after it, when nothing failed", () => {
    expect(ledgerHeader({ status: "ready", error: null, scheduleStatus: "ready" }, 300, totals(false), true, false).status).toBe(note);
    expect(ledgerHeader({ status: "ready", error: null, scheduleStatus: "unavailable" }, 300, totals(false), true, false).status).toBe(`${note} ${scheduleNotice("unavailable")}`);
  });

  it.each(["idle", "reading", "failed"] as const)("blanks the totals while the status is %s, though a stream row is held", (status) => {
    expect(ledgerHeader({ status, error: null, scheduleStatus: "idle" }, 1, totals(false), true, false)).toEqual({ blank: true, status: "" });
  });

  it("gives a failed first read's error alone, with no coverage note for totals that are blank", () => {
    expect(ledgerHeader({ status: "failed", error: "The node did not answer.", scheduleStatus: "idle" }, 1, totals(false), true, false)).toEqual({ blank: true, status: "The node did not answer." });
  });
});
