import { describe, expect, it } from "vitest";

import { waitingWords } from "./payout-words";

describe("waitingWords", () => {
  it("names the check's boundary in UTC when the node names one", () => {
    expect(waitingWords(Date.UTC(2026, 10, 15, 22, 30, 0))).toMatch(/^Waiting for the next check of the log, at 15 Nov 22:30:00 UTC\. .*another operator has verified the log/);
  });

  it("speaks of the checkpoint alone when the node names no check", () => {
    const words = waitingWords(undefined);
    expect(words).toMatch(/^Waiting for the next checkpoint\./);
    expect(words).not.toContain("check of the log");
  });
});
