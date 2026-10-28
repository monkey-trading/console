/** Whether a market's trading schedule is open at an instant. */

import type { Schedule } from "./engine/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
/** 1970-01-01 was a Thursday, day 3 of a week starting Monday. */
const EPOCH_WEEKDAY = 3;

/**
 * The minute of the UTC week (Monday 00:00 is 0) that `ms` falls in.
 */
export function minuteOfWeek(ms: number): number {
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  const day = Math.floor(minutes / MINUTES_PER_DAY);
  const weekday = (((day + EPOCH_WEEKDAY) % 7) + 7) % 7;
  const minuteOfDay = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return weekday * MINUTES_PER_DAY + minuteOfDay;
}

/**
 * Parses `Mon 14:30` to a minute of the week.
 * Error cases:
 * - the text is not a weekday and a 24-hour time; the mock's own listings never are, so this is a broken invariant
 */
export function parseWeekTime(text: string): number {
  const [day, time] = text.split(" ");
  const weekday = DAYS.findIndex((name) => name === day);
  const [hours, minutes] = (time ?? "").split(":").map(Number);
  if (weekday < 0 || hours === undefined || minutes === undefined || Number.isNaN(hours + minutes)) {
    throw new Error(`malformed week time: ${text}`);
  }
  return weekday * MINUTES_PER_DAY + hours * 60 + minutes;
}

/** Whether `schedule` is open at `ms`. The mock reads every schedule in UTC. */
export function isOpen(schedule: Schedule, ms: number): boolean {
  if (schedule.kind === "always_open") return true;
  const now = minuteOfWeek(ms);
  return schedule.windows.some((w) => now >= parseWeekTime(w.open) && now < parseWeekTime(w.close));
}

/** A short description of a schedule for the markets screen. */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === "always_open") return "24/7";
  const [first] = schedule.windows;
  if (!first) return "Closed";
  const last = schedule.windows[schedule.windows.length - 1] ?? first;
  return schedule.windows.length === 1
    ? `${first.open} – ${first.close} UTC`
    : `${first.open.slice(0, 3)}–${last.close.slice(0, 3)} ${first.open.slice(4)}–${first.close.slice(4)} UTC`;
}
