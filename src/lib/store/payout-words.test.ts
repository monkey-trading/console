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
});
