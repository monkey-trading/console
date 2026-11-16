"use client";

/** The Dashboard's MONKEY section: MONKEY per $1 of realised loss, with the halvings marked and the budget line, and MONKEY allocated and staked, both read at the page's range. */

import { useMemo } from "react";

import { overviewProblem } from "@/lib/dashboard-page";
import type { DashboardRangeId } from "@/lib/dashboard-range";
import { compactNumber, halvingsBetween, monkeyText, perUsdFigure } from "@/lib/monkey/figures";
import { formatStamp } from "@/lib/time";

import { ChartCard } from "../monkey/ChartCard";
import type { LineSpec } from "../monkey/ChartCanvas";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "../monkey/use-monkey";

const PER_LOSS_LINES: readonly LineSpec[] = [{ metric: "monkey_per_loss", label: "MONKEY per $1 of loss", tone: "glow" }];
const SUPPLY_LINES: readonly LineSpec[] = [
  { metric: "total_allocated", label: "Earned", tone: "amber" },
  { metric: "total_staked", label: "Staked", tone: "glow" },
];

const FOOTER = "mt-1 text-caption leading-relaxed text-fg-3";

/** The budget line's wording, which the placeholder held while the overview is read shares, so it wraps as the loaded line will. */
const budgetLine = (budget: string, haltAt: string | null) => `Each reward period distributes ${budget} in total${haltAt === null ? "" : `, until the amount halves at ${haltAt} UTC`}. Past halvings are marked on the chart.`;

/** The two MONKEY charts; the page's range drives their window. */
export function MonkeyCharts({ range }: { range: DashboardRangeId }) {
  const panel = useMonkeyPanel();
  const { overview } = usePanelState();
  const problem = overviewProblem(overview, "the reward schedule");
  const emissions = overview.value?.emissions ?? null;
  const minute = useConsoleSelect((state) => Math.floor(state.now / 60_000));
  const begins = overview.value?.begins_ms ?? 0;
  const startMs = emissions?.start_ms;
  const periodMs = emissions?.period_ms;
  const halvingPeriods = emissions?.halving_periods;
  const marks = useMemo(
    () => (startMs === undefined || periodMs === undefined || halvingPeriods === undefined ? [] : halvingsBetween({ start_ms: startMs, period_ms: periodMs, halving_periods: halvingPeriods }, begins, minute * 60_000)),
    [startMs, periodMs, halvingPeriods, begins, minute],
  );
  return (
    <>
      <ChartCard
        id="dash-per-loss" title="MONKEY per $1 of loss" feed={panel.feed("perLoss")} kind="steps" lines={PER_LOSS_LINES} format={perUsdFigure} marks={marks} timeframe={range}
        caption="The MONKEY earned for each US dollar of realised loss, shown by reward period. Each period's MONKEY is shared among traders in proportion to their realised losses, so the rate is higher when total losses in the period were small."
        footer={<>
          {problem !== null && <p className={FOOTER}>{problem}</p>}
          {emissions !== null && <p className={FOOTER}>{budgetLine(monkeyText(emissions.current_budget), emissions.next_halving_ms === null ? null : formatStamp(emissions.next_halving_ms))}</p>}
          {overview.status === "loading" && overview.value === null && <p aria-hidden="true" className={`${FOOTER} invisible`}>{budgetLine("1,000 MONKEY", formatStamp(0))}</p>}
        </>}
      />
      <ChartCard id="dash-supply" title="MONKEY earned and staked" feed={panel.feed("supply")} kind="lines" lines={SUPPLY_LINES} format={compactNumber} timeframe={range} heldFigure="000,000,000 MONKEY" />
    </>
  );
}
