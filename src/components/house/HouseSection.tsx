"use client";

/**
 * The House screen as a section (monkey-trading/console#311): its heading, the Overview, Risk and
 * Withdrawals tab bar, and the reads every tab shares. The section opens the house reads
 * (`openHousePanel`, `houseStats.setVisible`) once per visit, so the tab the route opens finds
 * them running; each card's own feeds follow it only while its tab is mounted.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { readBlock } from "@/lib/engine/attestation";
import { openHousePanel } from "@/lib/store/house";
import type { ConsoleState } from "@/lib/store/state";
import { SECTIONS } from "@/lib/nav";

import { useSession } from "../ConsoleProvider";
import { SectionTabs } from "../SectionTabs";
import { useSelected } from "./use-feed";

const SECTION = SECTIONS["/house"];

/** The page's trust and read gates: blocked while the node is not trusted, ready once its first answers landed, fresh while they keep refreshing. */
export const selectGate = (s: ConsoleState) => ({ blocked: readBlock(s.attestation, s.stream) !== null, ready: s.houseReady, fresh: s.houseFresh });

/** The House section: the heading and the sticky tab bar over the tab the route opens. */
export function HouseSection({ children }: { children: ReactNode }) {
  const { store } = useSession();
  // The house reads open with the section and close when it is left.
  useEffect(() => openHousePanel(store), [store]);
  const { blocked, ready, fresh } = useSelected(selectGate);
  const simulated = store.deps.client.signatures === "none";
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
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  // A tab switch shows the new tab from its top. Below lg the document scrolls, at lg and up the region
  // does; resetting both is a no-op on whichever does not scroll at the breakpoint.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    // Keyboard scrolling needs a tab stop on the scroll container, as on the other section pages.
    <div ref={scrollRef} role="region" aria-label="House details" tabIndex={0} className="relative min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:overflow-y-auto lg:scroll-pt-12">
      <div className="mx-auto w-full max-w-[120rem] px-4 py-5 max-lg:min-h-dvh sm:px-6">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lead tracking-caps text-glow uppercase">House</h2>
          <p className="text-caption text-fg-3">
            {simulated
              ? "The house takes the other side of every trade. This build simulates the node in the browser, so every figure here is generated and unsigned."
              : "The house takes the other side of every trade. Every figure comes from an answer the node's enclave signed for this page's request; an answer that does not verify is discarded, never shown."}
          </p>
        </header>
        {blocked && <p className="mt-3 text-data text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
        {!blocked && ready && !fresh && <p className="mt-3 text-data text-fg-2">The node&apos;s answers have stopped refreshing, so the figures on this page may be behind.</p>}
        {!blocked && !ready && <p className="mt-3 text-data text-fg-2">{simulated ? "Reading the simulated node's first answers…" : "Reading the node's first signed answers…"}</p>}
        {/* The tab bar stays in view at the top of the scroll region; its background covers what scrolls under it. A level above the charts' crosshair readout, which is later in the tree at the same z. */}
        <div className="sticky top-0 z-20 -mx-4 mt-4 bg-ink-1 px-4 sm:-mx-6 sm:px-6">
          <SectionTabs section={SECTION} />
        </div>
        {children}
      </div>
    </div>
  );
}
