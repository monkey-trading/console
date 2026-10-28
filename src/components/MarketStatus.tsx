/** A market's trading hours and stress level, as chips. */

import { describeSchedule } from "@/lib/schedule";
import type { MarketModel } from "@/lib/models";

export const STRESS_NAMES = ["Normal", "Elevated", "High", "Severe"] as const;
export const STRESS_TONE = ["text-glow", "text-amber", "text-amber", "text-alarm"] as const;

/** Open or closed with the hours, and the stress level with what it does to the spread. */
export function MarketStatus({ market }: { market: MarketModel }) {
  const name = STRESS_NAMES[market.stress] ?? "Normal";
  return (
    <p className="flex flex-wrap justify-end gap-2 text-label">
      <span className={`rounded border px-2 py-1 ${market.open ? "border-glow/40 text-glow" : "border-alarm/40 text-alarm"}`}>
        {market.open ? "Open" : "Closed"} · {describeSchedule(market.view.schedule)}
      </span>
      <span className={`rounded border border-line-2 px-2 py-1 ${STRESS_TONE[market.stress] ?? ""}`}>Stress {market.stress} · {name}</span>
    </p>
  );
}
