"use client";

/** The House section's Risk tab: the close-out map with its bands, the position map, the house's result at a price move, and every market's cap. */

import { CloseoutMap } from "./CloseoutMap";
import { MarketCaps } from "./HouseDetails";
import { PnlCurve } from "./PnlCurve";
import { PositionMap } from "./PositionMap";
import { selectGate } from "./HouseSection";
import { useSelected } from "./use-feed";

/** The Risk tab: the close-out map beside the position map and the house result at ±1%, the market caps across the page below. */
export function HouseRisk() {
  const { blocked, ready } = useSelected(selectGate);
  return (
    // The panels stay mounted while the node is not trusted, hidden, so each keeps its market, range and timeframe choice.
    <div className="mt-4 flex flex-col gap-2">
      {ready && (
        <div hidden={blocked} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 xl:grid xl:grid-cols-12">
            <CloseoutMap className="min-h-[34rem] xl:col-span-8" />
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
              <PositionMap />
              <PnlCurve />
            </div>
          </div>
          <MarketCaps />
        </div>
      )}
    </div>
  );
}
