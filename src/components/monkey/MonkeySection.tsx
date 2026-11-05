"use client";

/**
 * The MONKEY screen as a section (monkey-trading/console#311): its heading, the Emissions and
 * Activity tab bar, and the one panel both tabs read through, created once per visit to the
 * section. The panel's reads start once the node is trusted and stop when the section is left;
 * its charts are gone, so it reads the totals, the activity and the wallet figures alone.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { readBlock } from "@/lib/engine/attestation";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { SECTIONS } from "@/lib/nav";

import { useSession } from "../ConsoleProvider";
import { SectionTabs } from "../SectionTabs";
import { MonkeyPanelProvider, useConsoleSelect } from "./use-monkey";

const SECTION = SECTIONS["/monkey"];

/** The MONKEY section: the heading and the sticky tab bar over the tab the route opens. */
export function MonkeySection({ children }: { children: ReactNode }) {
  const { store } = useSession();
  // The panel serves both of the section's tabs, so it lives here, above the tab the route opens.
  const [panel] = useState(() => new MonkeyPanel(store, "monkey"));
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  // The wallet object changes whenever a wallet connects, even to the same address, and the chain reads follow it.
  const wallet = useConsoleSelect((state) => state.wallet);
  // Reads start once the node's answers can be trusted and stop when the section is left.
  useEffect(() => (trusted ? panel.start(() => document.visibilityState === "hidden") : undefined), [panel, trusted]);
  useEffect(() => {
    if (trusted) void panel.refreshWallet();
  }, [panel, trusted, wallet]);
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  // A tab switch shows the new tab from its top. Below lg the document scrolls, at lg and up the region
  // does; resetting both is a no-op on whichever does not scroll at the breakpoint.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <MonkeyPanelProvider value={panel}>
      {/* Keyboard scrolling needs a tab stop on the scroll container, as on the other section pages. */}
      <div ref={scrollRef} role="region" aria-label="MONKEY details" tabIndex={0} className="relative min-h-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:overflow-y-auto lg:scroll-pt-12">
        <div className="mx-auto w-full max-w-[110rem] px-4 py-5 max-lg:min-h-dvh sm:px-6">
          <h2 className="text-lead tracking-caps text-glow uppercase">MONKEY</h2>
          {!trusted && <p className="mt-3 text-data leading-relaxed text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
          {/* The tab bar stays in view at the top of the scroll region; its background covers what scrolls under it. */}
          <div className="sticky top-0 z-20 -mx-4 mt-4 bg-ink-1 px-4 sm:-mx-6 sm:px-6">
            <SectionTabs section={SECTION} />
          </div>
          {children}
        </div>
      </div>
    </MonkeyPanelProvider>
  );
}
