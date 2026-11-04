"use client";

/**
 * The MONKEY page: the account's MONKEY emissions and their claim, the token's supply and contracts,
 * the latest activity, and two charts of how emissions and the supply have moved. Staking, delegation
 * and USDC distributions are the Staking page's. Panels on the left and charts on the right where
 * there is room, stacked on a phone. Every figure is read only while the page is on screen.
 */

import { useEffect, useMemo, useState } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { compactNumber, halvingsBetween, monkeyText, perUsdFigure } from "@/lib/monkey/figures";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { formatStamp } from "@/lib/time";

import { useSession } from "./ConsoleProvider";
import { ActivityTable } from "./monkey/ActivityTable";
import { ChartCard } from "./monkey/ChartCard";
import type { LineSpec } from "./monkey/ChartCanvas";
import { ClaimPanel } from "./monkey/ClaimPanel";
import { TokenPanel } from "./monkey/TokenPanel";
import { MonkeyPanelProvider, useConsoleSelect, usePanelState } from "./monkey/use-monkey";

const PER_LOSS_LINES: readonly LineSpec[] = [{ metric: "monkey_per_loss", label: "MONKEY per $1 of loss", tone: "glow" }];
const SUPPLY_LINES: readonly LineSpec[] = [
  { metric: "total_allocated", label: "Allocated", tone: "amber" },
  { metric: "total_staked", label: "Staked", tone: "glow" },
];

/** The two charts, in the right-hand column. */
function Charts({ panel }: { panel: MonkeyPanel }) {
  const { overview } = usePanelState();
  const emissions = overview.value?.emissions ?? null;
  const minute = useConsoleSelect((state) => Math.floor(state.now / 60_000));
  const begins = overview.value?.begins_ms ?? 0;
  const startMs = emissions?.start_ms;
  const periodMs = emissions?.period_ms;
  const halvingPeriods = emissions?.halving_periods;
  const marks = useMemo(
    () => (startMs === undefined || periodMs === undefined || halvingPeriods === undefined ? [] : halvingsBetween({ start_ms: startMs, period_ms: periodMs, halving_periods: halvingPeriods }, begins, minute * 60_000)),
    [startMs, periodMs, halvingPeriods, begins, minute],
  );
  return (
    <>
      <ChartCard
        id="chart-per-loss" title="MONKEY per $1 of realised loss" feed={panel.feed("perLoss")} kind="steps" lines={PER_LOSS_LINES} format={perUsdFigure} marks={marks}
        caption="By emission period: each ten-minute budget is shared between that period's realised losses, less write-offs, so the rate is set by how much was lost in the period and a small loss in a quiet period reads high."
        footer={emissions === null ? null : (
          <p className="mt-1 text-caption leading-relaxed text-fg-3">
            The budget is {monkeyText(emissions.current_budget)} per period{emissions.next_halving_ms === null ? "" : `, and halves at ${formatStamp(emissions.next_halving_ms)} UTC`}. Halvings that have passed are marked.
          </p>
        )}
      />
      <ChartCard id="chart-supply" title="MONKEY allocated and staked" feed={panel.feed("supply")} kind="lines" lines={SUPPLY_LINES} format={compactNumber} />
    </>
  );
}

/** The MONKEY screen; the console's layout supplies the provider, the access gate and the shell. */
export function MonkeyPage() {
  const { store } = useSession();
  const [panel] = useState(() => new MonkeyPanel(store, "monkey"));
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  // The wallet object changes whenever a wallet connects, even to the same address, and the chain reads follow it.
  const wallet = useConsoleSelect((state) => state.wallet);
  // Reads start once the node's answers can be trusted and stop when the page is left.
  useEffect(() => (trusted ? panel.start(() => document.visibilityState === "hidden") : undefined), [panel, trusted]);
  useEffect(() => {
    if (trusted) void panel.refreshWallet();
  }, [panel, trusted, wallet]);
  return (
    <MonkeyPanelProvider value={panel}>
      {/* Keyboard scrolling needs a tab stop on the scroll container, as on the House page. */}
      <div role="region" aria-label="MONKEY details" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
        <div className="mx-auto w-full max-w-[110rem] px-4 py-5 sm:px-6">
          <h2 className="text-lead tracking-caps text-glow uppercase">MONKEY</h2>
          {!trusted && <p className="mt-3 text-data leading-relaxed text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
          {/* The figures are hidden, not unmounted, while the node is not trusted, so no figure from before a gap in the feed shows. */}
          <div className={`mt-4 ${trusted ? "grid" : "hidden"} items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,35rem)_minmax(0,1fr)]`}>
            <div className="flex min-w-0 flex-col gap-4">
              <ClaimPanel />
              <TokenPanel />
              <ActivityTable />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Charts panel={panel} />
            </div>
          </div>
        </div>
      </div>
    </MonkeyPanelProvider>
  );
}
