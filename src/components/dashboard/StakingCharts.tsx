"use client";

/** The Dashboard's Staking section: USDC distributed per epoch, and the total USDC distributed, read at the page's range. */

import { formatCompactUsd } from "@/lib/chart-format";
import type { DashboardRangeId } from "@/lib/dashboard-range";

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
      <ChartCard id="dash-epochs" title="USDC distributed per staking period" caption="What was distributed at the end of each staking period. While rotation is on, a fifth goes to the operator and the rest to stakers." feed={panel.feed("epochs")} kind="bars" lines={EPOCH_LINES} format={formatCompactUsd} timeframe={range} />
      <ChartCard id="dash-rewards" title="Total USDC distributed" caption="Everything distributed so far, including the operator's fifth." feed={panel.feed("rewards")} kind="area" lines={REWARD_LINES} format={formatCompactUsd} timeframe={range} />
    </>
  );
}
