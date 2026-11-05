"use client";

/** The Dashboard's Staking section: USDC distributed per epoch, and the total USDC distributed, read at the page's range. */

import { formatCompactUsd } from "@/lib/chart-format";
import { MONKEY_TIMEFRAME, type DashboardRangeId } from "@/lib/dashboard-range";

import { ChartCard } from "../monkey/ChartCard";
import type { LineSpec } from "../monkey/ChartCanvas";
import { useMonkeyPanel } from "../monkey/use-monkey";

const EPOCH_LINES: readonly LineSpec[] = [{ metric: "distributed_per_epoch", label: "USDC distributed", tone: "glow" }];
const REWARD_LINES: readonly LineSpec[] = [{ metric: "cumulative_distributed", label: "USDC distributed", tone: "glow" }];

/** The two distribution charts; the page's range drives their window. */
export function StakingCharts({ range }: { range: DashboardRangeId }) {
  const panel = useMonkeyPanel();
  return (
    <>
      <ChartCard id="dash-epochs" title="USDC distributed per epoch" caption="What each epoch close distributed: to stakers, and while operator rotation is on, a fifth to the operator in effect." feed={panel.feed("epochs")} kind="bars" lines={EPOCH_LINES} format={formatCompactUsd} timeframe={MONKEY_TIMEFRAME[range]} />
      <ChartCard id="dash-rewards" title="Total USDC distributed" caption="Cumulative, across every epoch close, the operator's fifth included." feed={panel.feed("rewards")} kind="area" lines={REWARD_LINES} format={formatCompactUsd} timeframe={MONKEY_TIMEFRAME[range]} />
    </>
  );
}
