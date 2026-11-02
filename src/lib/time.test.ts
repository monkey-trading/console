/** Tests for the UTC clock text. */

import { describe, expect, it } from "vitest";

import { formatClock, formatSpan, formatStamp } from "./time";

describe("time", () => {
  it("formats the clock and the date in UTC", () => {
    const ms = Date.UTC(2026, 9, 28, 15, 4, 5);
    expect(formatClock(ms)).toBe("15:04:05");
    expect(formatStamp(ms)).toBe("28 Oct 15:04:05");
    expect(formatStamp(Date.UTC(2028, 1, 29, 0, 0, 0))).toBe("29 Feb 00:00:00");
    expect(formatStamp(Date.UTC(1969, 11, 31, 23, 59, 59))).toBe("31 Dec 23:59:59");
  });

  it("formats a span in whole units, truncated, and reads a negative one as none", () => {
    const MIN = 60_000;
    expect(formatSpan(59_999)).toBe("under a minute");
    expect(formatSpan(-5 * MIN)).toBe("under a minute");
    expect(formatSpan(MIN)).toBe("1 min");
    expect(formatSpan(59 * MIN + 59_000)).toBe("59 min");
    expect(formatSpan(60 * MIN)).toBe("1 h");
    expect(formatSpan(3 * 60 * MIN + 12 * MIN)).toBe("3 h 12 min");
    expect(formatSpan(24 * 60 * MIN)).toBe("1 d");
    expect(formatSpan((2 * 24 + 4) * 60 * MIN + 59 * MIN)).toBe("2 d 4 h");
  });
});
