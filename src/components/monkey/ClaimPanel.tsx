"use client";

/** What the connected account can claim of its MONKEY emissions. */

import { claimMonkeyEmissions } from "@/lib/monkey/actions";
import { pendingEmission } from "@/lib/monkey/pending";

import { EmissionsCard } from "../EmissionsCard";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

export function ClaimPanel() {
  const panel = useMonkeyPanel();
  const { overview, activity } = usePanelState();
  const account = useConsoleSelect((state) => state.wallet?.address ?? null);
  return <EmissionsCard claim={() => claimMonkeyEmissions(panel)} pending={account === null ? { kind: "none" } : pendingEmission(activity, overview, account)} />;
}
