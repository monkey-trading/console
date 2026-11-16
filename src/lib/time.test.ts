/** Tests for the UTC clock text. */

import { describe, expect, it } from "vitest";

import { formatClock, formatSpan, formatSpanWords, formatStamp } from "./time";

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

  it("says a span in words for a sentence, singular or plural, truncated as the compact form", () => {
    const MIN = 60_000;
    expect(formatSpanWords(59_999)).toBe("less than a minute");
    expect(formatSpanWords(-5 * MIN)).toBe("less than a minute");
    expect(formatSpanWords(MIN)).toBe("1 minute");
    expect(formatSpanWords(59 * MIN + 59_000)).toBe("59 minutes");
    expect(formatSpanWords(60 * MIN)).toBe("1 hour");
    expect(formatSpanWords(61 * MIN)).toBe("1 hour and 1 minute");
    expect(formatSpanWords(3 * 60 * MIN + 12 * MIN)).toBe("3 hours and 12 minutes");
    expect(formatSpanWords(24 * 60 * MIN)).toBe("1 day");
    expect(formatSpanWords(25 * 60 * MIN)).toBe("1 day and 1 hour");
    expect(formatSpanWords((2 * 24 + 4) * 60 * MIN + 59 * MIN)).toBe("2 days and 4 hours");
  });
});
