/** Tests for the UTC clock text. */

import { describe, expect, it } from "vitest";

import { formatClock, formatStamp } from "./time";

describe("time", () => {
  it("formats the clock and the date in UTC", () => {
    const ms = Date.UTC(2026, 9, 28, 15, 4, 5);
    expect(formatClock(ms)).toBe("15:04:05");
    expect(formatStamp(ms)).toBe("28 Oct 15:04:05");
    expect(formatStamp(Date.UTC(2028, 1, 29, 0, 0, 0))).toBe("29 Feb 00:00:00");
    expect(formatStamp(Date.UTC(1969, 11, 31, 23, 59, 59))).toBe("31 Dec 23:59:59");
  });
});
