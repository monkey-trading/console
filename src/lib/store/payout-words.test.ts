import { describe, expect, it } from "vitest";

import { waitingWords } from "./payout-words";

const BOUNDARY = Date.UTC(2026, 10, 15, 22, 30, 0);

describe("waitingWords", () => {
  it("names the check's boundary in UTC while it is ahead", () => {
    expect(waitingWords(BOUNDARY, BOUNDARY - 60_000)).toMatch(/^Waiting for the next check of the log, at 15 Nov 22:30:00 UTC\. .*another operator has verified the log/);
  });

  it("says a boundary already past is a check that has not completed, not the next one", () => {
    const words = waitingWords(BOUNDARY, BOUNDARY + 3_600_000);
    expect(words).toMatch(/^Waiting for the check of the log due at 15 Nov 22:30:00 UTC, which has not completed yet\./);
    expect(words).not.toContain("next check");
  });

  it("speaks of the checkpoint alone when the node names no check", () => {
    const words = waitingWords(undefined, BOUNDARY);
    expect(words).toMatch(/^Waiting for the next checkpoint\./);
    expect(words).not.toContain("check of the log");
  });

  it("treats an unset clock as no boundary passed", () => {
    expect(waitingWords(BOUNDARY, 0)).toContain("the next check of the log");
  });
});
