"use client";

/**
 * The House screen: a dashboard of the house's book in one view. Its panels are figures (open
 * positions, the house, MONKEY, the withdrawal queue), charts (NAV, exposure, the close-out map,
 * the queue) and the parameters and checkpoints the log records. Every figure is from an answer the
 * node's enclave signed, and every read here runs only while this page is open.
 */

import { useEffect } from "react";

import { signBlock } from "@/lib/engine/attestation";
import { openHousePanel } from "@/lib/store/house";
import type { ConsoleState } from "@/lib/store/state";

import { useSession } from "./ConsoleProvider";
import { CloseoutMap } from "./house/CloseoutMap";
import { ExposureChart, NavChart, QueueChart } from "./house/Charts";
import { CapPanel, Checkpoints, MarketCaps, Parameters, WithdrawalHealth } from "./house/HouseDetails";
import { PnlCurve } from "./house/PnlCurve";
import { PositionMap } from "./house/PositionMap";
import { QueuePlace, QueueStats } from "./house/QueuePanels";
import { HouseFigures, MonkeyFigures, OpenPositions } from "./house/Stats";
import { useSelected } from "./house/use-feed";

const selectGate = (s: ConsoleState) => ({ blocked: signBlock(s.attestation, s.stream) !== null, ready: s.houseReady, fresh: s.houseFresh });
const STACK = "flex min-w-0 flex-col gap-2";

/** The House dashboard. */
export function HousePage() {
  const { store } = useSession();
  useEffect(() => openHousePanel(store), [store]);
  const { blocked, ready, fresh } = useSelected(selectGate);
  // A hidden tab, or a node that is not trusted right now, reads nothing: the feeds pause with it and resume at their own pace when it shows again.
  useEffect(() => {
    const sync = () => store.houseStats.setVisible(document.visibilityState !== "hidden" && !blocked);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      store.houseStats.setVisible(true);
    };
  }, [store, blocked]);
  return (
    // Keyboard scrolling needs a tab stop on the scroll container (the WAI-APG scrollable-region
    // pattern), which also reaches a dashboard whose panels hold only labels and a few controls.
    <div role="region" aria-label="House dashboard" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
      <div className="mx-auto flex w-full max-w-[120rem] flex-col gap-2 p-2 sm:p-3">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1">
          <h2 className="text-lead tracking-caps text-glow uppercase">House</h2>
          <p className="text-caption text-fg-3">
            The house takes the other side of every trade. Every figure comes from an answer the node&apos;s enclave signed for this
            page&apos;s request; an answer that does not verify is discarded, never shown.
          </p>
        </header>
        {blocked && <p className="px-1 text-data text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
        {!blocked && ready && !fresh && <p className="px-1 text-data text-fg-2">The node&apos;s answers have stopped refreshing, so the figures on this page may be behind.</p>}
        {!blocked && !ready && <p className="px-1 text-data text-fg-2">Reading the node&apos;s first signed answers…</p>}
        {ready && (
          // The panels stay mounted while the node is not trusted, hidden, so each keeps its market, timeframe and Live choice.
          <div hidden={blocked} className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
              <div className={`${STACK} xl:col-span-3`}><OpenPositions /><MonkeyFigures /></div>
              <div className={`${STACK} xl:col-span-3`}><HouseFigures /><CapPanel /><Checkpoints /></div>
              <NavChart className="min-h-80 md:col-span-2 xl:col-span-6" />
            </div>
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
              <div className={`${STACK} xl:col-span-4`}>
                <ExposureChart className="min-h-72 flex-1" />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <PnlCurve />
                  <PositionMap />
                </div>
              </div>
              <CloseoutMap className="min-h-[34rem] xl:col-span-8" />
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
              <div className="xl:col-span-3 [&>section]:h-full"><QueueStats /></div>
              <div className="xl:col-span-3 [&>section]:h-full"><QueuePlace /></div>
              <QueueChart className="min-h-64 md:col-span-2 xl:col-span-6" />
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
              <div className="md:col-span-2 xl:col-span-6 [&>section]:h-full"><MarketCaps /></div>
              <div className="xl:col-span-3 [&>section]:h-full"><Parameters /></div>
              <div className="xl:col-span-3 [&>section]:h-full"><WithdrawalHealth /></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
