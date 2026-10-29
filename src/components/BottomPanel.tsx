"use client";

/** Under the chart: positions, resting orders, account history, and the node's activity. */

import { useId, useState } from "react";

import { formatClock } from "@/lib/time";

import { useConsole } from "./ConsoleProvider";
import { HistoryList } from "./HistoryList";
import { OrdersView } from "./OrdersView";
import { PositionsView } from "./PositionsView";

const TABS = ["positions", "orders", "history", "activity"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { positions: "Positions", orders: "Orders", history: "History", activity: "Activity" };

function Activity() {
  const { feed } = useConsole();
  if (feed.length === 0) return <p className="px-4 py-6 text-caption text-fg-3">Waiting for the node's stream.</p>;
  return (
    <ol>
      {feed.map((line) => (
        <li key={line.id} className="grid grid-cols-[5rem_1fr] gap-3 border-b border-line px-4 py-2 text-caption last:border-b-0">
          <time className="text-fg-3">{formatClock(line.ts)}</time>
          <span className="text-fg-2">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function BottomPanel() {
  const { account } = useConsole();
  const [tab, setTab] = useState<Tab>("positions");
  const id = useId();
  const counts: Partial<Record<Tab, number>> = { positions: account?.positions.length, orders: account?.orders.length };
  return (
    <section aria-label="Account activity" className="flex min-h-80 min-w-0 flex-1 shrink-0 flex-col border-t border-line lg:h-60 lg:min-h-0 lg:flex-none">
      <div role="tablist" aria-label="Account panels" className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] border-b border-line lg:flex lg:flex-wrap lg:gap-x-1 lg:px-2">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" id={`${id}-${t}`} aria-selected={tab === t} aria-controls={`${id}-panel`} onClick={() => setTab(t)}
            className={`min-h-11 border-b-2 px-1 py-3 text-center text-label max-lg:flex max-lg:flex-col max-lg:items-center max-lg:justify-center lg:min-h-0 lg:px-3 tracking-caps uppercase focus-visible:outline-2 focus-visible:outline-glow ${tab === t ? "border-glow text-glow" : "border-transparent text-fg-3 hover:text-fg-2"}`}>
            {LABEL[t]}{counts[t] ? <span className="max-lg:block"> ({counts[t]})</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" tabIndex={0} id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
        {tab === "positions" && <PositionsView />}
        {tab === "orders" && <OrdersView />}
        {tab === "history" && <HistoryList />}
        {tab === "activity" && <Activity />}
      </div>
    </section>
  );
}
