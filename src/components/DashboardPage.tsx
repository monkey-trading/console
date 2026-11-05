"use client";

/**
 * The Dashboard screen: every series chart the node serves in three sections — House, MONKEY and
 * Staking — under one range control. The house charts read through the store's house feeds and the
 * MONKEY and Staking charts through a panel of this page's own; every read runs only while this
 * page is open, its tab is visible and the node is trusted, as on the House page.
 */

import { useEffect, useId, useState, type ReactNode } from "react";

import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE, HOUSE_RANGE, type DashboardRangeId } from "@/lib/dashboard-range";
import { readBlock } from "@/lib/engine/attestation";
import { MonkeyPanel } from "@/lib/monkey/panel";

import { useSession } from "./ConsoleProvider";
import { MonkeyCharts } from "./dashboard/MonkeyCharts";
import { StakingCharts } from "./dashboard/StakingCharts";
import { ExposureChart, NavChart, QueueChart } from "./house/Charts";
import { MonkeyPanelProvider, useConsoleSelect } from "./monkey/use-monkey";
import { Select } from "./Select";

const SECTIONS = [
  { href: "#house", label: "House" },
  { href: "#monkey", label: "MONKEY" },
  { href: "#staking", label: "Staking" },
] as const;

const SECTION_LINK = "inline-flex min-h-11 items-center text-caption text-glow hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow lg:min-h-6";

/** One Dashboard section: its heading carries the id the section links target. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section id={id} aria-labelledby={heading} tabIndex={-1} className="outline-none">
      <h3 id={heading} className="border-b border-line pb-1.5 text-label tracking-caps text-fg-2 uppercase">{title}</h3>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** The Dashboard; the console's layout supplies the provider, the access gate and the shell. */
export function DashboardPage() {
  const { store } = useSession();
  const [panel] = useState(() => new MonkeyPanel(store, "dashboard"));
  const [range, setRange] = useState<DashboardRangeId>(DEFAULT_DASHBOARD_RANGE);
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  // The house feeds read only while the Dashboard is open; visibility also asks that the tab shows and the node is trusted, as on the House page.
  useEffect(() => {
    store.houseStats.setOpen(true);
    return () => store.houseStats.setOpen(false);
  }, [store]);
  useEffect(() => {
    const sync = () => store.houseStats.setVisible(document.visibilityState !== "hidden" && trusted);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      store.houseStats.setVisible(true);
    };
  }, [store, trusted]);
  // The panel's reads — the MONKEY and Staking charts and the totals the budget line leans on — start once the node's answers can be trusted and stop when the page is left.
  useEffect(() => (trusted ? panel.start(() => document.visibilityState === "hidden") : undefined), [panel, trusted]);
  const houseRange = HOUSE_RANGE[range];
  return (
    <MonkeyPanelProvider value={panel}>
      {/* Keyboard scrolling needs a tab stop on the scroll container, as on the House and MONKEY pages. */}
      <div role="region" aria-label="Dashboard" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
        <div className="mx-auto flex w-full max-w-[120rem] flex-col gap-4 p-4 sm:p-6">
          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lead tracking-caps text-glow uppercase">Dashboard</h2>
            <p className="text-caption text-fg-3">Every time series the node serves — the house&apos;s NAV, exposure and withdrawal queue, MONKEY emissions and supply, and the USDC distributions — with one range setting every chart&apos;s window.</p>
          </header>
          {!trusted && <p className="text-data text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
          {/* The charts are hidden, not unmounted, while the node is not trusted, so no figure from before a gap in the feed shows. */}
          <div hidden={!trusted} className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <nav aria-label="Dashboard sections" className="flex flex-wrap items-center gap-x-2">
                {SECTIONS.map(({ href, label }, index) => (
                  <span key={href} className="flex items-center gap-x-2">
                    {index > 0 && <span aria-hidden="true" className="text-fg-3">·</span>}
                    <a href={href} className={SECTION_LINK}>{label}</a>
                  </span>
                ))}
              </nav>
              <div className="w-28">
                <Select<DashboardRangeId> label="Range" value={range} options={DASHBOARD_RANGES.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={setRange} />
              </div>
            </div>
            <Section id="house" title="House">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <NavChart range={houseRange} className="min-h-80" />
                <ExposureChart range={houseRange} className="min-h-80" />
              </div>
              <QueueChart range={houseRange} className="min-h-64" />
            </Section>
            <Section id="monkey" title="MONKEY">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <MonkeyCharts range={range} />
              </div>
            </Section>
            <Section id="staking" title="Staking">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <StakingCharts range={range} />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </MonkeyPanelProvider>
  );
}
