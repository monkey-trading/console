import { describe, expect, it } from "vitest";

import type { DistributionView, EmissionsView } from "../engine/stats-types";
import { budgetAwaitingCheckpoint, closeAwaitingCheckpoint, formatCountdown, nextBudgetMs, nextCloseMs, spokenCountdown } from "./countdown";

const START = 1_793_662_020_000;
const emissions = { start_ms: START, period_ms: 600_000 } as EmissionsView;
const NEXT = 1_793_662_920_000;
const distribution = { epoch_ms: 300_000, next_close_ms: NEXT } as DistributionView;

describe("nextBudgetMs", () => {
  it("is the next boundary strictly after the clock", () => {
    expect(nextBudgetMs(emissions, START + 1)).toBe(START + 600_000);
    expect(nextBudgetMs(emissions, START + 599_999)).toBe(START + 600_000);
    expect(nextBudgetMs(emissions, START + 600_000)).toBe(START + 1_200_000);
    expect(nextBudgetMs(emissions, START + 600_001)).toBe(START + 1_200_000);
  });

  it("is the start before the schedule begins and at it", () => {
    expect(nextBudgetMs(emissions, START - 1)).toBe(START);
    expect(nextBudgetMs(emissions, START)).toBe(START + 600_000);
  });

  it("is unknown without a schedule, a usable period or a clock", () => {
    expect(nextBudgetMs(null, START)).toBeNull();
    expect(nextBudgetMs({ ...emissions, period_ms: 0 }, START)).toBeNull();
    expect(nextBudgetMs(emissions, 0)).toBeNull();
  });
});

describe("nextCloseMs", () => {
  it("is the node's next close while it is ahead", () => {
    expect(nextCloseMs(distribution, NEXT - 1)).toBe(NEXT);
    expect(nextCloseMs(distribution, NEXT - 299_000)).toBe(NEXT);
  });

  it("is the following close once the clock reaches the stale one", () => {
    expect(nextCloseMs(distribution, NEXT)).toBe(NEXT + 300_000);
    expect(nextCloseMs(distribution, NEXT + 1)).toBe(NEXT + 300_000);
    expect(nextCloseMs(distribution, NEXT + 300_000)).toBe(NEXT + 600_000);
    expect(nextCloseMs(distribution, NEXT + 1_000_000)).toBe(NEXT + 1_200_000);
  });

  it("is unknown without a distribution or a usable epoch", () => {
    expect(nextCloseMs(null, NEXT)).toBeNull();
    expect(nextCloseMs({ ...distribution, epoch_ms: 0 }, NEXT)).toBeNull();
    expect(nextCloseMs(distribution, 0)).toBeNull();
  });
});

describe("formatCountdown", () => {
  const at = (ms: number) => formatCountdown(START + 10_000_000, START + 10_000_000 - ms);

  it("reads Xm YYs under an hour", () => {
    expect(at(462_000)).toBe("7m 42s");
    expect(at(600_000)).toBe("10m 00s");
    expect(at(65_000)).toBe("1m 05s");
    expect(at(3_599_000)).toBe("59m 59s");
  });

  it("reads seconds alone under a minute", () => {
    expect(at(59_000)).toBe("59s");
    expect(at(5_000)).toBe("5s");
    expect(at(60_000)).toBe("1m 00s");
  });

  it("rounds a part second up, so it never reads 0s before the boundary", () => {
    expect(at(1)).toBe("1s");
    expect(at(1_001)).toBe("2s");
  });

  it("keeps the seconds from an hour", () => {
    expect(at(3_600_000)).toBe("1h 00m 00s");
    expect(at(3_852_000)).toBe("1h 04m 12s");
    expect(at(90_000_000)).toBe("25h 00m 00s");
  });
});

describe("spokenCountdown", () => {
  const at = (ms: number) => spokenCountdown(1_000_000_000, 1_000_000_000 - ms);

  it("changes once a minute", () => {
    expect(at(462_000)).toBe("8 minutes");
    expect(at(421_000)).toBe("8 minutes");
    expect(at(420_000)).toBe("7 minutes");
    expect(at(61_000)).toBe("2 minutes");
  });

  it("says under a minute for the last minute", () => {
    expect(at(60_000)).toBe("under a minute");
    expect(at(1_000)).toBe("under a minute");
  });

  it("names hours", () => {
    expect(at(3_600_000)).toBe("1 hour");
    expect(at(3_900_000)).toBe("1 hour 5 minutes");
    expect(at(7_200_000)).toBe("2 hours");
  });
});

describe("budgetAwaitingCheckpoint", () => {
  const schedule = (period: number | null) => ({ start_ms: START, period_ms: 600_000, period }) as EmissionsView;

  it("holds only while the answer's period is behind the clock's", () => {
    // The answer holds period 0; the clock inside it counts down normally.
    expect(budgetAwaitingCheckpoint(schedule(0), START + 599_999)).toBe(false);
    // The boundary passed: the answer for the closed period has not landed.
    expect(budgetAwaitingCheckpoint(schedule(0), START + 600_000)).toBe(true);
    expect(budgetAwaitingCheckpoint(schedule(0), START + 1_199_999)).toBe(true);
    // The fresh answer names period 1: the countdown resumes.
    expect(budgetAwaitingCheckpoint(schedule(1), START + 600_000)).toBe(false);
    expect(budgetAwaitingCheckpoint(schedule(1), START + 1_199_999)).toBe(false);
    expect(budgetAwaitingCheckpoint(schedule(1), START + 1_200_000)).toBe(true);
  });

  it("never waits without a schedule or a started one", () => {
    expect(budgetAwaitingCheckpoint(null, START + 600_000)).toBe(false);
    expect(budgetAwaitingCheckpoint(schedule(null), START + 600_000)).toBe(false);
  });
});

describe("closeAwaitingCheckpoint", () => {
  it("holds from the named close until a fresh answer moves it", () => {
    expect(closeAwaitingCheckpoint(distribution, NEXT - 1)).toBe(false);
    expect(closeAwaitingCheckpoint(distribution, NEXT)).toBe(true);
    expect(closeAwaitingCheckpoint(distribution, NEXT + 299_999)).toBe(true);
    // The fresh answer names the following close.
    const fresh = { epoch_ms: 300_000, next_close_ms: NEXT + 300_000 } as DistributionView;
    expect(closeAwaitingCheckpoint(fresh, NEXT)).toBe(false);
    expect(closeAwaitingCheckpoint(fresh, NEXT + 300_000)).toBe(true);
  });

  it("never waits without a distribution", () => {
    expect(closeAwaitingCheckpoint(null, NEXT)).toBe(false);
  });
});
