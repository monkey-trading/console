"use client";

/** The Staking section's Rewards tab: the USDC distribution claim, the rewards figures, and the account's distributions by epoch. */

import { readBlock } from "@/lib/engine/attestation";

import { DistributionClaim } from "../monkey/DistributionClaim";
import { RewardsPanel } from "../monkey/RewardsPanel";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { DistributionHistory } from "./DistributionHistory";

/** The Rewards tab: the claim and the rewards figures in two columns from 1024 px, the account's distributions across the page below. */
export function StakingRewards() {
  const { epochs, history } = useStaking();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  return (
    // The figures are hidden, not unmounted, while the node is not trusted, as on the Delegate tab.
    <div className={`mt-4 ${trusted ? "grid" : "hidden"} gap-4`}>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <DistributionClaim epochs={epochs} />
        <RewardsPanel />
      </div>
      <DistributionHistory history={history} />
    </div>
  );
}
