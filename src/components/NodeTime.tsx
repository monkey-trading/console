"use client";

/** A phrase about the node's clock, such as "5 min ago": redrawn only when its text changes, not on every tick. */

import { useConsoleValue } from "./ConsoleProvider";

/** Shows `format(now)` with `now` the sequenced clock the console follows, never the device's; "—" until the clock has started. */
export function NodeTime({ format }: { format: (nowMs: number) => string }) {
  const text = useConsoleValue((state) => (state.now === 0 ? "" : format(state.now)));
  return <>{text === "" ? "—" : text}</>;
}
