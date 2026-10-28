/** Tests for market hours. */

import { describe, expect, it } from "vitest";

import type { Schedule } from "./engine/types";
import { describeSchedule, isOpen, minuteOfWeek, parseWeekTime } from "./schedule";

const WEEKDAYS: Schedule = {
  kind: "weekly", tz: "UTC", closed_dates: [],
  windows: ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => ({ open: `${d} 14:30`, close: `${d} 21:00` })),
};

describe("minuteOfWeek", () => {
  it("counts from Monday 00:00 UTC", () => {
    expect(minuteOfWeek(Date.UTC(2026, 9, 26, 0, 0))).toBe(0); // Monday
    expect(minuteOfWeek(Date.UTC(2026, 9, 28, 15, 0))).toBe(2 * 1440 + 900); // Wednesday
    expect(minuteOfWeek(Date.UTC(2026, 9, 25, 23, 59))).toBe(7 * 1440 - 1); // Sunday
  });
});

describe("isOpen", () => {
  it("is open inside a window and closed at its close, overnight, and at weekends", () => {
    expect(isOpen({ kind: "always_open" }, 0)).toBe(true);
    expect(isOpen(WEEKDAYS, Date.UTC(2026, 9, 28, 14, 30))).toBe(true);
    expect(isOpen(WEEKDAYS, Date.UTC(2026, 9, 28, 14, 29))).toBe(false);
    expect(isOpen(WEEKDAYS, Date.UTC(2026, 9, 28, 21, 0))).toBe(false);
    expect(isOpen(WEEKDAYS, Date.UTC(2026, 9, 31, 16, 0))).toBe(false); // Saturday
  });
});

describe("parseWeekTime and describeSchedule", () => {
  it("rejects malformed text and describes the hours", () => {
    expect(parseWeekTime("Tue 01:30")).toBe(1440 + 90);
    expect(() => parseWeekTime("Someday 10:00")).toThrow("malformed week time");
    expect(describeSchedule({ kind: "always_open" })).toBe("24/7");
    expect(describeSchedule(WEEKDAYS)).toBe("Mon–Fri 14:30–21:00 UTC");
  });
});
