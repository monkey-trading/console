/** A market's trading schedule and its parts, as `GET /v1/markets` lists them (`engine_core::session::Schedule`). */

/** One weekly trading window, `"Mon 09:30"` to `"Mon 16:00"` in venue-local time. */
export interface Window {
  open: string;
  close: string;
}

/** A half-open venue-local period `[from, to)` as the engine's `session::Period` serializes it. */
export interface LocalPeriod {
  from: string;
  to: string;
}

/** A market's trading schedule as the wire lists it; dated exceptions are absent when there are none. */
export type Schedule =
  | { kind: "always_open" }
  | { kind: "weekly"; tz: string; windows: Window[]; closed_dates: string[]; closures?: LocalPeriod[]; special_sessions?: LocalPeriod[] };
