/** Tests for the engine's session rule as the chart's log-scan replay applies it (`crates/core/src/session.rs`). */

import { describe, expect, it } from "vitest";

import { sessionRule } from "./mark-session";
import type { Schedule } from "./types";

/** US equities hours in New York time, as the engine's session tests build them. */
const US_EQUITIES: Schedule = {
  kind: "weekly",
  tz: "America/New_York",
  windows: ["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap((day) => [{ open: `${day} 09:30`, close: `${day} 16:00` }]),
  closed_dates: [],
};

const MIN = 60_000;
/** New York is UTC-4 on these October 2026 dates (summer time ends 1 November 2026). */
const ny = (day: number, hourUtc: number, minuteUtc = 0, secondMs = 0) => Date.UTC(2026, 9, day, hourUtc, minuteUtc) + secondMs;

describe("sessionRule.inSession", () => {
  it("admits a quote stamped and sequenced inside one session", () => {
    const rule = sessionRule(US_EQUITIES);
    const at = ny(20, 14); // Tue 10:00 in New York
    expect(rule.inSession(at, at + 5 * MIN, 10 * MIN)).toBe(true);
  });

  it("refuses a span that crosses the session's close or open, or sits on a weekend", () => {
    const rule = sessionRule(US_EQUITIES);
    const beforeClose = ny(20, 19, 59); // Tue 15:59
    expect(rule.inSession(beforeClose, beforeClose + 2 * MIN, 10 * MIN)).toBe(false);
    const beforeOpen = ny(20, 13, 29); // Tue 09:29
    expect(rule.inSession(beforeOpen, beforeOpen + 2 * MIN, 10 * MIN)).toBe(false);
    const saturday = ny(24, 14); // Sat 10:00
    expect(rule.inSession(saturday, saturday + MIN, 10 * MIN)).toBe(false);
  });

  it("checks only the two ends of a span longer than the freshness window", () => {
    const rule = sessionRule(US_EQUITIES);
    const stamped = ny(19, 19, 59); // Mon 15:59
    const sequenced = ny(20, 13, 31); // Tue 09:31
    expect(rule.inSession(stamped, sequenced, 60 * MIN)).toBe(true);
  });

  it("reads closed dates and special sessions in venue-local time", () => {
    const withHolidays: Schedule = { ...US_EQUITIES, closed_dates: ["2026-11-26"] };
    const thursday = Date.UTC(2026, 10, 26, 15); // Thu 10:00 in New York (winter time, UTC-5)
    expect(sessionRule(withHolidays).inSession(thursday, thursday + MIN, 10 * MIN)).toBe(false);
    const withSpecial: Schedule = {
      ...US_EQUITIES,
      special_sessions: [{ from: "2026-10-24T10:00:00", to: "2026-10-24T14:00:00" }],
    };
    const saturday = ny(24, 14); // Sat 10:00, outside the weekly windows
    expect(sessionRule(withSpecial).inSession(saturday, saturday + MIN, 10 * MIN)).toBe(true);
  });

  it("sees a dated closure's edge between two open instants", () => {
    const earlyClose: Schedule = {
      ...US_EQUITIES,
      closures: [{ from: "2026-10-20T13:00:00", to: "2026-10-20T16:00:00" }],
    };
    const rule = sessionRule(earlyClose);
    const halted = ny(20, 17, 30); // Tue 13:30, inside the closure
    expect(rule.inSession(halted, halted + MIN, 10 * MIN)).toBe(false);
    const across = ny(20, 16, 59); // Tue 12:59
    expect(rule.inSession(across, across + 2 * MIN, 10 * MIN)).toBe(false);
  });

  it("keeps the seconds a dated period's boundary carries", () => {
    const middayHalt: Schedule = {
      ...US_EQUITIES,
      closures: [{ from: "2026-10-20T13:00:30", to: "2026-10-20T13:00:50" }],
    };
    const rule = sessionRule(middayHalt);
    // The span sits inside one minute, so only the boundary's seconds can reject it.
    const halted = ny(20, 17, 0, 40 * 1000); // Tue 13:00:40, inside the halt
    expect(rule.inSession(halted, halted + 5_000, 10 * MIN)).toBe(false);
    const before = ny(20, 17, 0, 20 * 1000); // Tue 13:00:20, before it
    expect(rule.inSession(before, before + 5_000, 10 * MIN)).toBe(true);
  });

  it("keeps the fraction a dated period's boundary carries", () => {
    const fleetingHalt: Schedule = {
      ...US_EQUITIES,
      closures: [{ from: "2026-10-20T13:00:30.500", to: "2026-10-20T13:00:30.900" }],
    };
    const rule = sessionRule(fleetingHalt);
    const halted = ny(20, 17, 0, 30_700); // Tue 13:00:30.700, inside the halt
    expect(rule.inSession(halted, halted + 100, 10 * MIN)).toBe(false);
    const before = ny(20, 17, 0, 30_200); // Tue 13:00:30.200, before it
    expect(rule.inSession(before, before + 100, 10 * MIN)).toBe(true);
  });

  it("treats a window that wraps the week as open on both sides of the boundary", () => {
    const fxWeek: Schedule = {
      kind: "weekly",
      tz: "America/New_York",
      windows: [{ open: "Sun 17:00", close: "Fri 17:00" }],
      closed_dates: [],
    };
    const rule = sessionRule(fxWeek);
    const tuesday = ny(20, 14); // Tue 10:00, inside the Sun–Fri window
    expect(rule.inSession(tuesday, tuesday + MIN, 10 * MIN)).toBe(true);
    const sundayEvening = ny(25, 22); // Sun 18:00, after the window opens
    expect(rule.inSession(sundayEvening, sundayEvening + MIN, 10 * MIN)).toBe(true);
    const saturday = ny(24, 14); // Sat 10:00, in the wrapped span
    expect(rule.inSession(saturday, saturday + MIN, 10 * MIN)).toBe(false);
    const afterFriday = ny(23, 21, 1); // Fri 17:01, past the window's close
    expect(rule.inSession(afterFriday, afterFriday + MIN, 10 * MIN)).toBe(false);
  });

  it("admits everything for an always-open schedule", () => {
    const rule = sessionRule({ kind: "always_open" });
    expect(rule.inSession(0, Number.MAX_SAFE_INTEGER, 1)).toBe(true);
  });
});
