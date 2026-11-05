"use client";

/** The Staking section's Epochs tab: the distribution's state, every closed epoch, and the two distribution charts (until they move to the Dashboard). */

import { formatCompactUsd } from "@/lib/chart-format";
import { readBlock } from "@/lib/engine/attestation";

import { ChartCard } from "../monkey/ChartCard";
import type { LineSpec } from "../monkey/ChartCanvas";
import { DistributionPanel } from "../monkey/DistributionPanel";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { EpochHistory } from "./EpochHistory";
import { useOperatorLabel } from "./use-operator-label";

const EPOCH_LINES: readonly LineSpec[] = [{ metric: "distributed_per_epoch", label: "USDC distributed", tone: "glow" }];
const REWARD_LINES: readonly LineSpec[] = [{ metric: "cumulative_distributed", label: "USDC distributed", tone: "glow" }];

/** The Epochs tab: the distribution and the closed epochs in two columns from 1280 px, the two distribution charts below. */
export function StakingEpochs() {
  const { panel, epochs, operators } = useStaking();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const labelOf = useOperatorLabel(operators);
  return (
    // The figures are hidden, not unmounted, while the node is not trusted, as on the Delegate tab.
    <div className={`mt-4 ${trusted ? "grid" : "hidden"} gap-4`}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <DistributionPanel />
        <EpochHistory epochs={epochs} labelOf={labelOf} />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <ChartCard id="chart-epochs" title="USDC distributed per epoch" caption="What each epoch close distributed: to stakers, and while operator rotation is on, a fifth to the operator in effect." feed={panel.feed("epochs")} kind="bars" lines={EPOCH_LINES} format={formatCompactUsd} />
        <ChartCard id="chart-rewards" title="Total USDC distributed" caption="Cumulative, across every epoch close, the operator's fifth included." feed={panel.feed("rewards")} kind="area" lines={REWARD_LINES} format={formatCompactUsd} />
      </div>
    </div>
  );
}
