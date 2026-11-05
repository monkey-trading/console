"use client";

/** The House section's Overview tab, its default route: the house's figures, its book against the cap, and the log's parameters and checkpoints. */

import { DashboardLink } from "../DashboardLink";
import { CapPanel, Checkpoints, Parameters } from "./HouseDetails";
import { selectGate } from "./HouseSection";
import { HouseFigures, MonkeyFigures, OpenPositions } from "./Stats";
import { useSelected } from "./use-feed";

/** The Overview tab: the House, open positions and MONKEY figures, exposure against the cap, parameters and checkpoints, then the link to their history on the Dashboard. */
export function HouseOverview() {
  const { blocked, ready } = useSelected(selectGate);
  return (
    <div className="mt-4 flex flex-col gap-2">
      {/* The panels stay mounted while the node is not trusted, hidden, so no figure from before a gap in the feed shows. */}
      {ready && (
        <div hidden={blocked} className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          <HouseFigures />
          <OpenPositions />
          <MonkeyFigures />
          <CapPanel />
          <Parameters />
          <Checkpoints />
        </div>
      )}
      <DashboardLink href="/dashboard#house">See the history of NAV, exposure and the queue on the Dashboard</DashboardLink>
    </div>
  );
}
