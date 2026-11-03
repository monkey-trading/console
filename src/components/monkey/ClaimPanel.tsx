"use client";

/** What the connected account can claim: its MONKEY emissions and its USDC distributions, side by side where there is room. */

import { claimMonkeyEmissions } from "@/lib/monkey/actions";
import { pendingEmission } from "@/lib/monkey/pending";

import { EmissionsCard } from "../EmissionsCard";
import { DistributionClaim } from "./DistributionClaim";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

export function ClaimPanel() {
  const panel = useMonkeyPanel();
  const { overview, activity } = usePanelState();
  const account = useConsoleSelect((state) => state.wallet?.address ?? null);
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <EmissionsCard claim={() => claimMonkeyEmissions(panel)} pending={account === null ? { kind: "none" } : pendingEmission(activity, overview, account)} />
      <DistributionClaim />
    </div>
  );
}
