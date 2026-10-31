/**
 * The engine's session rule as the chart's log-scan replay applies it, ported from
 * `crates/core/src/session.rs` (`Schedule::is_open`, `open_throughout`) and
 * `crates/core/src/futures.rs` (`in_session`): a quote counts only when the venue is open at both
 * ends of the span from its stamp to the command's sequenced time, and at every instant between
 * when the span is not longer than the market's freshness window. Venue-local time is read through
 * the platform's time-zone database, as the engine reads chrono-tz. The replay uses this only to
 * drop quotes the engine would reject, so a session divergence cannot invent a mark.
 */

import { parseWeekTime } from "../schedule";
import type { LocalPeriod, Schedule } from "./types";

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;
const WEEKDAY_FROM_MONDAY: Readonly<Record<string, number>> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The engine's session question for one market: whether a quote's span belongs to one open session. */
export interface SessionRule {
  /** Whether a quote stamped `ts` and sequenced at `now` belongs to one open session. */
  inSession(ts: number, now: number, maxAgeMs: number): boolean;
}

/** A weekly schedule compiled for evaluation: parsed windows and one formatter for its zone. */
interface Weekly {
  readonly format: Intl.DateTimeFormat;
  readonly windows: readonly { open: number; close: number }[];
  readonly closedDates: ReadonlySet<string>;
  /** Dated periods with their bounds normalized to nine fractional digits, so lexicographic order is time order. */
  readonly closures: readonly LocalPeriod[];
  readonly specials: readonly LocalPeriod[];
}

/** The venue-local reading of an instant, in the forms the schedule's fields compare in. */
interface LocalTime {
  /** `"2026-11-27"` form, as `closed_dates` lists. */
  readonly date: string;
  /** `"2026-11-27T13:00:00.000000000"` form (normalized), as periods bound. */
  readonly stamp: string;
  /** Minute of the local week, Monday 00:00 being 0. */
  readonly minuteOfWeek: number;
}

/** Compiles `schedule` into the rule the scan applies per quote. */
export function sessionRule(schedule: Schedule): SessionRule {
  if (schedule.kind === "always_open") return { inSession: () => true };
  const weekly: Weekly = {
    format: new Intl.DateTimeFormat("en-US", {
      timeZone: schedule.tz, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }),
    windows: schedule.windows.map((w) => ({ open: parseWeekTime(w.open), close: parseWeekTime(w.close) })),
    closedDates: new Set(schedule.closed_dates),
    closures: (schedule.closures ?? []).map(normalizePeriod),
    specials: (schedule.special_sessions ?? []).map(normalizePeriod),
  };
  return {
    inSession(ts, now, maxAgeMs) {
      // `crates/core/src/futures.rs` `in_session`: a span longer than the freshness window holds
      // only a quote too old to count, so only its two ends are checked.
      const first = Math.min(ts, now);
      const last = Math.max(ts, now);
      if (last - first > maxAgeMs) return isOpenAt(weekly, first) && isOpenAt(weekly, last);
      return openThroughout(weekly, first, last);
    },
  };
}

/** Whether the venue is open at `ms`, as the engine's `Schedule::is_open`. */
function isOpenAt(weekly: Weekly, ms: number): boolean {
  const local = localTime(weekly, ms);
  if (weekly.specials.some((p) => within(p, local.stamp))) return true;
  const regular = !weekly.closedDates.has(local.date) && weekly.windows.some((w) => withinWindow(w, local.minuteOfWeek));
  return regular && !weekly.closures.some((p) => within(p, local.stamp));
}

/** Whether `minuteOfWeek` falls in the window, wrapping over the week boundary when the window does (`session.rs` `Window::contains`). */
function withinWindow(window: { open: number; close: number }, minuteOfWeek: number): boolean {
  if (window.open < window.close) return minuteOfWeek >= window.open && minuteOfWeek < window.close;
  return minuteOfWeek >= window.open || minuteOfWeek < window.close;
}

/** Whether `stamp` falls in the half-open local period `[from, to)`; both are normalized to nine fractional digits, so lexicographic order is time order. */
function within(period: LocalPeriod, stamp: string): boolean {
  return period.from <= stamp && stamp < period.to;
}

/** Normalizes a period's bounds to `"…SS.fffffffff"`, padding or extending the fraction the wire carries so comparisons hold at any precision. */
function normalizePeriod(period: LocalPeriod): LocalPeriod {
  return { from: normalizeStamp(period.from), to: normalizeStamp(period.to) };
}

/** Normalizes a local timestamp or period bound to nine fractional digits; absent fractions read as zero. */
function normalizeStamp(text: string): string {
  const dot = text.indexOf(".");
  return dot === -1 ? `${text}.000000000` : `${text.slice(0, dot + 1)}${text.slice(dot + 1).padEnd(9, "0")}`;
}

/** Whether the venue is open at every instant from `from` to `to`, as the engine's `open_throughout`. */
function openThroughout(weekly: Weekly, from: number, to: number): boolean {
  if (from > to || !isOpenAt(weekly, from) || !isOpenAt(weekly, to)) return false;
  // Openness changes only at a minute boundary or a dated period's edge, so checking those
  // instants checks them all; the caller bounds the span by the freshness window.
  for (let m = Math.floor(from / MINUTE_MS) + 1; m <= Math.floor(to / MINUTE_MS); m++) {
    if (!isOpenAt(weekly, m * MINUTE_MS)) return false;
  }
  const first = localTime(weekly, from).stamp;
  const last = localTime(weekly, to).stamp;
  const edges = [...weekly.closures, ...weekly.specials]
    .flatMap((p) => [p.from, p.to])
    .filter((edge) => first < edge && edge <= last);
  return edges.every((edge) => isOpenAt(weekly, localToMs(weekly, edge)));
}

/** The venue-local reading of `ms` in the schedule's zone, with milliseconds carried into the stamp. */
function localTime(weekly: Weekly, ms: number): LocalTime {
  const parts = weekly.format.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Some time-zone databases render midnight as hour 24 even under h23; it is this day's 00:00.
  const hour = get("hour") === "24" ? "00" : get("hour");
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = WEEKDAY_FROM_MONDAY[get("weekday")];
  if (weekday === undefined) throw new Error(`unknown weekday name ${get("weekday")}`);
  // Zone offsets are whole minutes, so the millisecond remainder is the sub-second part of the local second.
  const fraction = String(((ms % 1000) + 1000) % 1000).padStart(3, "0");
  return {
    date,
    stamp: normalizeStamp(`${date}T${hour}:${get("minute")}:${get("second")}.${fraction}`),
    minuteOfWeek: weekday * MINUTES_PER_DAY + Number(hour) * 60 + Number(get("minute")),
  };
}

/** The UTC instant a venue-local naive stamp names in the schedule's zone. */
function localToMs(weekly: Weekly, stamp: string): number {
  // Guess UTC, read the zone's wall clock at that guess, and correct by the difference; one
  // refinement settles it even when the zone's offset changes within the guessed hour.
  const target = Date.parse(`${stamp}Z`);
  let ms = target;
  for (let i = 0; i < 2; i++) ms = target - (Date.parse(`${localTime(weekly, ms).stamp}Z`) - ms);
  return ms;
}
