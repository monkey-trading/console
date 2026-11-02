"use client";

/** What the connected account can claim: its MONKEY emissions and its USDC distributions, side by side where there is room. */

import { claimMonkeyEmissions } from "@/lib/monkey/actions";

import { useSession } from "../ConsoleProvider";
import { EmissionsCard } from "../EmissionsCard";
import { DistributionClaim } from "./DistributionClaim";
import { useMonkeyPanel } from "./use-monkey";

export function ClaimPanel() {
  const panel = useMonkeyPanel();
  const { store } = useSession();
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <EmissionsCard refresh={() => void store.monkeySession.panel?.refreshWallet(true)} claim={() => claimMonkeyEmissions(panel)} />
      <DistributionClaim />
    </div>
  );
}
