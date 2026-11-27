import { describe, expect, it } from "vitest";

import { waitingWords } from "./payout-words";

const BOUNDARY = Date.UTC(2026, 10, 15, 22, 30, 0);

describe("waitingWords", () => {
  it("names the check's boundary in UTC while it is ahead", () => {
    expect(waitingWords(BOUNDARY, BOUNDARY - 60_000)).toMatch(/^The withdrawal is waiting for the next check of the server's records, which is due at 15 Nov 22:30:00 UTC\. .*another operator's server has independently checked the records/);
  });

  it("says a boundary already past is a check that has not completed, not the next one", () => {
    const words = waitingWords(BOUNDARY, BOUNDARY + 3_600_000);
    expect(words).toMatch(/^The withdrawal is waiting for a check of the server's records that was due at 15 Nov 22:30:00 UTC and has not yet been completed\./);
    expect(words).not.toContain("next check");
  });

  it("speaks of the checkpoint alone when the node names no check", () => {
    const words = waitingWords(undefined, BOUNDARY);
    expect(words).toMatch(/^You can claim the withdrawal here once the vault has recorded the next snapshot\.$/);
    expect(words).not.toContain("check of the server's records");
  });

  it("treats an unset clock as no boundary passed", () => {
    expect(waitingWords(BOUNDARY, 0)).toContain("the next check of the server's records");
  });

  it("names the operator's confirmation, with no time, while a withdrawal waits for an installation (monkey-trading/console#521)", () => {
    const words = waitingWords(undefined, BOUNDARY, true);
    expect(words).toBe("The withdrawal is waiting for the platform's operator to be confirmed. You can claim the withdrawal here once that has happened and the vault has recorded the next snapshot.");
    expect(words).not.toMatch(/UTC|due/);
  });

  it("names a routine verification, with no time and no engine term, while a withdrawal waits for a check within the turn (monkey-trading/console#535)", () => {
    const words = waitingWords(undefined, BOUNDARY, false, true);
    expect(words).toBe("The withdrawal is waiting for a routine verification of the server's records, which usually completes within a few minutes. You can claim the withdrawal here once the verification is complete and the vault has recorded the next snapshot.");
    expect(words).not.toMatch(/UTC|due|checkpoint|log check|seq|turn/i);
  });
});
