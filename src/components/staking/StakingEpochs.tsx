"use client";

/** The Staking section's Epochs tab: the distribution's state and every closed epoch, with the distributions' history charts on the Dashboard. */

import { readBlock } from "@/lib/engine/attestation";

import { DashboardLink } from "../DashboardLink";
import { DistributionPanel } from "../monkey/DistributionPanel";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { EpochHistory } from "./EpochHistory";
import { useOperatorLabel } from "./use-operator-label";

/** The Epochs tab: the distribution and the closed epochs in two columns from 1280 px, and a link to the distributions' charts on the Dashboard. */
export function StakingEpochs() {
  const { epochs, operators } = useStaking();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const labelOf = useOperatorLabel(operators);
  return (
    // The figures are hidden, not unmounted, while the node is not trusted, as on the Delegate tab.
    <div className={`mt-4 ${trusted ? "grid" : "hidden"} gap-4`}>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <DistributionPanel />
        <EpochHistory epochs={epochs} labelOf={labelOf} />
      </div>
      <DashboardLink href="/dashboard#staking">See the history of distributions on the Dashboard</DashboardLink>
    </div>
  );
}
