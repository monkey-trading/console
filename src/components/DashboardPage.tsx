"use client";

/**
 * The house, MONKEY and Staking histories under one range control. Reads run while this page is
 * open, visible and trusted; House charts wait for the first signed answers, and deep links restore once.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE, type DashboardRangeId } from "@/lib/dashboard-range";
import { houseGateLine, isPlainClick, overviewProblem, SECTION_IDS, sectionOfHash, type DashboardSectionId } from "@/lib/dashboard-page";
import { readBlock } from "@/lib/engine/attestation";
import { fixedFromWire, fixedToNumber } from "@/lib/fixed";
import { MonkeyPanel } from "@/lib/monkey/panel";

import { useSession } from "./ConsoleProvider";
import { MonkeyCharts } from "./dashboard/MonkeyCharts";
import { StakingCharts } from "./dashboard/StakingCharts";
import { ExposureChart, NavChart, QueueChart } from "./house/Charts";
import { MonkeyPanelProvider, useConsoleSelect } from "./monkey/use-monkey";
import { Select } from "./Select";

const SECTION_LABELS = { house: "House", monkey: "MONKEY", staking: "Staking" } as const;

const SECTION_LINK = "inline-flex min-h-11 items-center text-caption text-glow hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow lg:min-h-6";

/** One Dashboard section; the section element carries the id the in-page links and a #hash load target. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section id={id} aria-labelledby={heading} tabIndex={-1} className="outline-none">
      <h3 id={heading} className="border-b border-line pb-1.5 text-label tracking-caps text-fg-2 uppercase">{title}</h3>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * A section link's click: scrolls to the section, focuses it and puts its hash in the address
 * by replacing the current history entry, keeping the state Next.js holds for it. A native fragment
 * jump pushes an entry with no state, which Next.js ignores on Back, leaving the page it left on
 * screen under the Dashboard's address.
 */
function openSection(event: MouseEvent<HTMLAnchorElement>, id: DashboardSectionId) {
  if (!isPlainClick(event)) return;
  event.preventDefault();
  const section = document.getElementById(id);
  section?.scrollIntoView();
  section?.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, "", `#${id}`);
}

/** The Dashboard; the console's layout supplies the provider, the access gate and the shell. */
export function DashboardPage() {
  const { store } = useSession();
  const [panel] = useState(() => new MonkeyPanel(store, "dashboard"));
  const [range, setRange] = useState<DashboardRangeId>(DEFAULT_DASHBOARD_RANGE);
  const hashRestored = useRef(false);
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const houseReady = useConsoleSelect((state) => state.houseReady);
  const houseFresh = useConsoleSelect((state) => state.houseFresh);
  const simulated = store.deps.client.signatures === "none";
  const gate = houseGateLine({ trusted, ready: houseReady, fresh: houseFresh, simulated });
  // The NAV chart's liquidity floor comes from the panel's own MONKEY read, so the house feeds do not read the node again for it.
  const overview = useSyncExternalStore(panel.subscribe, panel.getSnapshot, panel.getSnapshot).overview;
  const floorText = overview.value?.distribution?.liquidity_floor;
  const floor = {
    value: floorText === undefined ? null : fixedToNumber(fixedFromWire(floorText)),
    note: overviewProblem(overview, "the liquidity floor"),
  };
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
  // A cold load's hash scroll finds nothing while the sections are hidden (the node not yet trusted), so when trust first arrives the named section scrolls into view and takes focus, once.
  useEffect(() => {
    if (!trusted || hashRestored.current) return;
    hashRestored.current = true;
    const id = sectionOfHash(window.location.hash);
    if (id === null) return;
    const section = document.getElementById(id);
    section?.scrollIntoView();
    section?.focus();
  }, [trusted]);
  return (
    <MonkeyPanelProvider value={panel}>
      {/* Keyboard scrolling needs a tab stop on the scroll container, as on the House and MONKEY pages. */}
      <div role="region" aria-label="Dashboard" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
        <div className="mx-auto flex w-full max-w-[120rem] flex-col gap-4 p-4 sm:p-6">
          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lead tracking-caps text-glow uppercase">Dashboard</h2>
            <p className="text-caption text-fg-3">The history of the house&apos;s NAV, exposure and withdrawal queue, MONKEY emissions and supply, and the USDC distributions — with one range setting every chart&apos;s window.</p>
          </header>
          {!trusted && <p className="text-data text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
          {/* The charts are hidden, not unmounted, while the node is not trusted, so no figure from before a gap in the feed shows. */}
          <div hidden={!trusted} className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <nav aria-label="Dashboard sections" className="flex flex-wrap items-center gap-x-2">
                {SECTION_IDS.map((id, index) => (
                  <span key={id} className="flex items-center gap-x-2">
                    {index > 0 && <span aria-hidden="true" className="text-fg-3">·</span>}
                    <a href={`#${id}`} onClick={(event) => openSection(event, id)} className={SECTION_LINK}>{SECTION_LABELS[id]}</a>
                  </span>
                ))}
              </nav>
              <div className="ml-auto w-28">
                <Select<DashboardRangeId> label="Range" value={range} options={DASHBOARD_RANGES.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={setRange} align="end" />
              </div>
            </div>
            <Section id={SECTION_IDS[0]} title="House">
              <p className="min-h-5 text-data text-fg-2">{gate}</p>
              {/* Until the first signed answers land the panels hold their whole shape, so the sections below stay in place. */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <NavChart range={range} className="min-h-80" floor={floor} pending={!houseReady} />
                <ExposureChart range={range} className="min-h-80" pending={!houseReady} />
              </div>
              <QueueChart range={range} className="min-h-64" walked={false} pending={!houseReady} />
            </Section>
            <Section id={SECTION_IDS[1]} title="MONKEY">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MonkeyCharts range={range} />
              </div>
            </Section>
            <Section id={SECTION_IDS[2]} title="Staking">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <StakingCharts range={range} />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </MonkeyPanelProvider>
  );
}
