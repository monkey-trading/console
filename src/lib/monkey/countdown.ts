/** When the next MONKEY budget and the next USDC epoch close come, from the node's `/v1/monkey` answer and its clock, and how a wait reads, in minutes and hours or, for a vote's days, in days. */

import type { DistributionView, EmissionsView } from "../engine/stats-types";

/** The first boundary of a `periodMs` grid anchored at `startMs` that is strictly after `nowMs`; `startMs` itself before it. */
function nextOnGrid(startMs: number, periodMs: number, nowMs: number): number {
  if (nowMs < startMs) return startMs;
  return startMs + (Math.floor((nowMs - startMs) / periodMs) + 1) * periodMs;
}

const usable = (ms: number) => Number.isSafeInteger(ms) && ms > 0;

/** The next ten-minute budget, or null when there is no emission schedule or it is unusable. */
export function nextBudgetMs(emissions: EmissionsView | null, nowMs: number): number | null {
  if (emissions === null || nowMs <= 0 || !usable(emissions.period_ms) || !Number.isSafeInteger(emissions.start_ms)) return null;
  return nextOnGrid(emissions.start_ms, emissions.period_ms, nowMs);
}

/**
 * The next epoch close: the node's `next_close_ms`, or once the clock has reached it and the next
 * answer has not landed, the following close by the epoch's length, never a time already past.
 */
export function nextCloseMs(distribution: DistributionView | null, nowMs: number): number | null {
  if (distribution === null || nowMs <= 0 || !usable(distribution.epoch_ms) || !Number.isSafeInteger(distribution.next_close_ms)) return null;
  return distribution.next_close_ms > nowMs ? distribution.next_close_ms : nextOnGrid(distribution.next_close_ms, distribution.epoch_ms, nowMs);
}

/**
 * Whether the clock has passed the budget the answer still holds: the period the node's answer
 * names is behind the period the clock says is open, so the answer carrying the close has not
 * landed and the countdown's place says it is waiting, instead of counting to the next budget
 * beside the old period's figures.
 */
export function budgetAwaitingCheckpoint(emissions: EmissionsView | null, nowMs: number): boolean {
  if (emissions === null || emissions.period === null || nowMs <= 0 || !usable(emissions.period_ms) || !Number.isSafeInteger(emissions.start_ms)) {
    return false;
  }
  return Math.floor((nowMs - emissions.start_ms) / emissions.period_ms) > emissions.period;
}

/** Whether the close the answer names has passed: the next answer, which the checkpoint carries, has not landed. */
export function closeAwaitingCheckpoint(distribution: DistributionView | null, nowMs: number): boolean {
  return (
    distribution !== null &&
    nowMs > 0 &&
    usable(distribution.epoch_ms) &&
    Number.isSafeInteger(distribution.next_close_ms) &&
    distribution.next_close_ms <= nowMs
  );
}

/** Whole seconds left, rounded up so the last second reads 0:01 and the figure never shows 0:00 before the boundary. */const seconds = (targetMs: number, nowMs: number) => Math.max(Math.ceil((targetMs - nowMs) / 1000), 0);

const two = (n: number) => String(n).padStart(2, "0");

/** `7m 42s`, `42s` under a minute, or `1h 04m 12s` from an hour; seconds and, past an hour, minutes keep two digits. */
export function formatCountdown(targetMs: number, nowMs: number): string {
  const total = seconds(targetMs, nowMs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${two(m)}m ${two(s)}s`;
  return m > 0 ? `${m}m ${two(s)}s` : `${s}s`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** The wait in words, to the minute and rounded up, so it changes once a minute: "8 minutes", "1 hour 5 minutes". */
export function spokenCountdown(targetMs: number, nowMs: number): string {
  const total = seconds(targetMs, nowMs);
  if (total <= 60) return "under a minute";
  const minutes = Math.ceil(total / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return plural(m, "minute");
  return m === 0 ? plural(h, "hour") : `${plural(h, "hour")} ${plural(m, "minute")}`;
}

const DAY_S = 86_400;

/** A wait that may run to days, such as a vote's seven days: `6d 23h 59m` from a day, as `formatCountdown` below one. */
export function formatLongCountdown(targetMs: number, nowMs: number): string {
  const total = seconds(targetMs, nowMs);
  if (total < DAY_S) return formatCountdown(targetMs, nowMs);
  return `${Math.floor(total / DAY_S)}d ${two(Math.floor((total % DAY_S) / 3600))}h ${two(Math.floor((total % 3600) / 60))}m`;
}

/** `formatLongCountdown` in words, to the hour from a day, so it changes once an hour: "6 days 23 hours"; as `spokenCountdown` below a day. */
export function spokenLongCountdown(targetMs: number, nowMs: number): string {
  const total = seconds(targetMs, nowMs);
  if (total < DAY_S) return spokenCountdown(targetMs, nowMs);
  const days = Math.floor(total / DAY_S);
  const hours = Math.floor((total % DAY_S) / 3600);
  return hours === 0 ? plural(days, "day") : `${plural(days, "day")} ${plural(hours, "hour")}`;
}
