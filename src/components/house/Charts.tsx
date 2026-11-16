"use client";

/** The House page's three series charts: NAV with the liquidity floor, long and short exposure, and the withdrawal queue. */

import { useMemo } from "react";

import { fixedFromWire, fixedToNumber } from "@/lib/fixed";
import { exactTotals } from "@/lib/house";
import type { RangeId } from "@/lib/house-series";
import { feedProblem } from "@/lib/store/house-feed-text";
import { monkeyFeed } from "@/lib/store/house-feeds";
import type { ConsoleState } from "@/lib/store/state";

import { useSession } from "../ConsoleProvider";
import { SeriesPanel, type LineSpec } from "./SeriesPanel";
import { useFeed, useSelected } from "./use-feed";
import { useMarketOptions } from "./use-markets";

const NAV_LINES: readonly LineSpec[] = [{ id: "nav", metric: "nav", label: "House value", tip: "This is what the house is worth now: its cash minus traders' profit on open positions.", tone: "glow", area: true }];
const EXPOSURE_LINES: readonly LineSpec[] = [
  { id: "long", metric: "long", label: "Long", tip: "This is the total size of traders' long positions in this market. They profit when the price rises, and the house loses.", tone: "glow", nonNegative: true, sampled: true },
  { id: "short", metric: "short", label: "Short", tip: "This is the total size of traders' short positions in this market. They profit when the price falls.", tone: "ember", nonNegative: true, sampled: true },
];
const QUEUE_LINES: readonly LineSpec[] = [{ id: "queue", metric: "withdrawal_queue", label: "Queued", tip: "This is what's still owed to traders in the withdrawal queue.", tone: "amber", area: true, nonNegative: true }];

const selectNav = (s: ConsoleState) => ({ nav: fixedToNumber(s.house.nav) });
// The headline is the walked total only while the walk was complete, steady and its last read succeeded; otherwise the chart's own last bucket stands in.
const selectQueue = (s: ConsoleState) => {
  const totals = exactTotals(s.withdrawalTotals, s.queueFailed);
  return { queue: totals === null ? null : fixedToNumber(totals.remaining) };
};
const selectExposure = (s: ConsoleState): Record<string, number | null> =>
  Object.fromEntries((s.house.scan?.markets ?? []).flatMap((m) => [[`${m.market}:long`, m.long === null ? null : fixedToNumber(m.long)], [`${m.market}:short`, m.short === null ? null : fixedToNumber(m.short)]]));

/** House NAV over time, with everything below the distribution's liquidity floor shaded. The floor is read here, unless the page already holds it from its own MONKEY read (the Dashboard), with `note` saying when that read is failing. */
export function NavChart({ range, className, floor, pending }: { range?: RangeId; className?: string; floor?: { value: number | null; note: string | null }; pending?: boolean }) {
  const { store } = useSession();
  const readHere = floor === undefined;
  const monkey = useFeed(useMemo(() => (readHere ? monkeyFeed(store) : null), [readHere, store]));
  const floorText = readHere ? monkey.data?.distribution?.liquidity_floor : undefined;
  const value = readHere ? (floorText === undefined ? null : fixedToNumber(fixedFromWire(floorText))) : floor.value;
  const note = readHere ? feedProblem(monkey, "the reserve") : floor.note;
  return (
    <SeriesPanel
      title="House value"
      tip="This is what the house is worth: its cash minus traders' profit on open positions at current prices. The shaded area is below the reserve, and stakers are paid only from value above it."
      lines={NAV_LINES}
      markets={null}
      range={range}
      currents={useSelected(selectNav)}
      floor={value}
      note={note}
      pending={pending}
      className={className}
    />
  );
}

/** Clients' long and short notional in one market, from the node's account scans. */
export function ExposureChart({ range, className, pending }: { range?: RangeId; className?: string; pending?: boolean }) {
  const markets = useMarketOptions();
  return (
    <SeriesPanel
      title="House exposure"
      tip="This is the total size of traders' long and short positions in this market, in dollars. The house takes the other side of both."
      lines={EXPOSURE_LINES}
      markets={markets}
      range={range}
      currents={useSelected(selectExposure)}
      pending={pending}
      className={className}
    />
  );
}

/**
 * What the withdrawal queue owes over time. The headline above the chart is the queue walk's
 * totals where a walk runs and is current (the House page); the Dashboard passes `walked={false}`,
 * since no walk runs there, and the chart's own last bucket stands in. Each chart takes `pending` while its page waits for the first signed answers.
 */
export function QueueChart({ range, className, walked = true, pending }: { range?: RangeId; className?: string; walked?: boolean; pending?: boolean }) {
  const totals = useSelected(selectQueue);
  return (
    <SeriesPanel
      title="Withdrawal queue"
      tip="This is the total waiting in the withdrawal queue: requests that couldn't be paid straight away."
      lines={QUEUE_LINES}
      markets={null}
      range={range}
      currents={walked ? totals : undefined}
      pending={pending}
      className={className}
    />
  );
}
