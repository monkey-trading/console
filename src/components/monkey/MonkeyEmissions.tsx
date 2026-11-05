"use client";

/** The MONKEY section's Emissions tab, its default route: the account's MONKEY emissions with their claim, and the token. */

import { readBlock } from "@/lib/engine/attestation";

import { DashboardLink } from "../DashboardLink";
import { ClaimPanel } from "./ClaimPanel";
import { TokenPanel } from "./TokenPanel";
import { useConsoleSelect } from "./use-monkey";

/** The Emissions tab: the claim and the token side by side from 1024 px, then the link to their history on the Dashboard. */
export function MonkeyEmissions() {
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* The figures are hidden, not unmounted, while the node is not trusted: no figure from before a gap in the feed shows. */}
      <div className={trusted ? "grid grid-cols-1 items-start gap-4 lg:grid-cols-2" : "hidden"}>
        <ClaimPanel />
        <TokenPanel />
        <div className="col-span-full">
          <DashboardLink href="/dashboard#monkey">See the history of emissions and supply on the Dashboard</DashboardLink>
        </div>
      </div>
    </div>
  );
}
