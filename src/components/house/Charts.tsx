"use client";

/** The House page's three series charts: NAV with the liquidity floor, long and short exposure, and the withdrawal queue. */

import { useMemo } from "react";

import { fixedFromWire, fixedToNumber } from "@/lib/fixed";
import { exactTotals } from "@/lib/house";
import { feedProblem } from "@/lib/store/house-feed-text";
import { monkeyFeed } from "@/lib/store/house-feeds";
import type { ConsoleState } from "@/lib/store/state";

import { useSession } from "../ConsoleProvider";
import { SeriesPanel, type LineSpec } from "./SeriesPanel";
import { useFeed, useSelected } from "./use-feed";
import { useMarketOptions } from "./use-markets";

const NAV_LINES: readonly LineSpec[] = [{ id: "nav", metric: "nav", label: "NAV", tip: "The house's net asset value now: its cash less its clients' unrealised profit.", tone: "glow", area: true }];
const EXPOSURE_LINES: readonly LineSpec[] = [
  { id: "long", metric: "long", label: "Long", tip: "Clients' long notional in this market: positions that gain when the price rises, so the house loses.", tone: "glow" },
  { id: "short", metric: "short", label: "Short", tip: "Clients' short notional in this market: positions that gain when the price falls.", tone: "ember" },
];
const QUEUE_LINES: readonly LineSpec[] = [{ id: "queue", metric: "withdrawal_queue", label: "Queued", tip: "What the withdrawal queue still owes now.", tone: "amber", area: true }];

const selectNav = (s: ConsoleState) => ({ nav: fixedToNumber(s.house.nav) });
// The headline is the walked total only while the walk was complete, steady and its last read succeeded; otherwise the chart's own last bucket stands in.
const selectQueue = (s: ConsoleState) => {
  const totals = exactTotals(s.withdrawalTotals, s.queueFailed);
  return { queue: totals === null ? null : fixedToNumber(totals.remaining) };
};
const selectExposure = (s: ConsoleState): Record<string, number | null> =>
  Object.fromEntries((s.house.scan?.markets ?? []).flatMap((m) => [[`${m.market}:long`, m.long === null ? null : fixedToNumber(m.long)], [`${m.market}:short`, m.short === null ? null : fixedToNumber(m.short)]]));

/** House NAV over time, with everything below the distribution's liquidity floor shaded. */
export function NavChart({ className }: { className?: string }) {
  const { store } = useSession();
  const monkey = useFeed(useMemo(() => monkeyFeed(store), [store]));
  const floorText = monkey.data?.distribution?.liquidity_floor;
  const floorProblem = feedProblem(monkey, "the liquidity floor");
  return (
    <SeriesPanel
      title="NAV"
      tip="The house's net asset value: its cash less its clients' unrealised profit at current marks. Where the node reports one, the shaded area is below the liquidity floor, under which no staker distribution is paid."
      lines={NAV_LINES}
      markets={null}
      currents={useSelected(selectNav)}
      floor={floorText === undefined ? null : fixedToNumber(fixedFromWire(floorText))}
      note={floorProblem}
      className={className}
    />
  );
}

/** Clients' long and short notional in one market, from the node's account scans. */
export function ExposureChart({ className }: { className?: string }) {
  const markets = useMarketOptions();
  return (
    <SeriesPanel
      title="House exposure"
      tip="What the house's clients hold in the market, long and short, in dollars of notional. The house takes the other side of both."
      lines={EXPOSURE_LINES}
      markets={markets}
      currents={useSelected(selectExposure)}
      className={className}
    />
  );
}

/** What the withdrawal queue owes over time. */
export function QueueChart({ className }: { className?: string }) {
  return (
    <SeriesPanel
      title="Queue total"
      tip="The dollars waiting in the first-in first-out withdrawal queue: requests the vault could not pay yet."
      lines={QUEUE_LINES}
      markets={null}
      currents={useSelected(selectQueue)}
      className={className}
    />
  );
}
