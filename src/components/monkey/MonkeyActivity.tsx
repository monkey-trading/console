"use client";

/** The MONKEY section's Activity tab: the latest MONKEY events, newest first. */

import { readBlock } from "@/lib/engine/attestation";

import { ActivityTable } from "./ActivityTable";
import { useConsoleSelect } from "./use-monkey";

/** The Activity tab: the latest MONKEY events across the page. */
export function MonkeyActivity() {
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  // Hidden, not unmounted, while the node is not trusted, as on the Emissions tab.
  return (
    <div className={`mt-4 ${trusted ? "" : "hidden"}`}>
      <ActivityTable />
    </div>
  );
}
