/** The emission schedule a P&L row's period is read against, from `GET /v1/monkey`'s `emissions` group. */

/** When emission periods start and how long each runs; `period` is the open one. */
export interface EmissionSchedule {
  startMs: number;
  periodMs: number;
  /** The period the node's latest command fell in; null before the schedule starts. */
  period: number | null;
}

/** The `emissions` group of `GET /v1/monkey`, narrowed to what the ledger reads. */
export interface EmissionsWire {
  start_ms: number;
  period_ms: number;
  period: number | null;
}

/** The schedule from the node's group, or null when the node reports none or one that cannot divide time into periods. */
export function decodeSchedule(wire: EmissionsWire | null | undefined): EmissionSchedule | null {
  if (!wire || !Number.isSafeInteger(wire.start_ms) || !Number.isSafeInteger(wire.period_ms) || wire.period_ms <= 0) return null;
  const period = wire.period !== null && Number.isSafeInteger(wire.period) ? wire.period : null;
  return { startMs: wire.start_ms, periodMs: wire.period_ms, period };
}

/** The period a stamp falls in: `floor((ts - start_ms) / period_ms)`. */
export function periodOf(schedule: EmissionSchedule, ts: number): number {
  return Math.floor((ts - schedule.startMs) / schedule.periodMs);
}

/** The first instant of `period`. */
export function periodStart(schedule: EmissionSchedule, period: number): number {
  return schedule.startMs + period * schedule.periodMs;
}
