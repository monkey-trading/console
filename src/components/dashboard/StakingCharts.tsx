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
      <ChartCard id="dash-epochs" title="USDC distributed per staking period" caption="The USDC distributed at the end of each staking period. While operator rotation is active, one fifth of each distribution is paid to the operator and the remainder to stakers." feed={panel.feed("epochs")} kind="bars" lines={EPOCH_LINES} format={formatCompactUsd} timeframe={range} />
      <ChartCard id="dash-rewards" title="Total USDC distributed" caption="The total USDC distributed to date, including the operator's share." feed={panel.feed("rewards")} kind="area" lines={REWARD_LINES} format={formatCompactUsd} timeframe={range} />
    </>
  );
}
