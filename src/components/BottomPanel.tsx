"use client";

/** Under the chart: positions, resting orders, account history, and the node's activity. */

import { useId, useState } from "react";

import { formatClock } from "@/lib/time";

import { useConsole } from "./ConsoleProvider";
import { HistoryList } from "./HistoryList";
import { OrdersView, PositionsView } from "./PositionsTable";

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
    <section aria-label="Account activity" className="flex h-60 min-w-0 shrink-0 flex-col border-t border-line">
      <div role="tablist" aria-label="Account panels" className="flex gap-1 border-b border-line px-2">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" id={`${id}-${t}`} aria-selected={tab === t} aria-controls={`${id}-panel`} onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-3 text-label tracking-caps uppercase focus-visible:outline-2 focus-visible:outline-glow ${tab === t ? "border-glow text-glow" : "border-transparent text-fg-3 hover:text-fg-2"}`}>
            {LABEL[t]}{counts[t] ? ` (${counts[t]})` : ""}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="min-h-0 flex-1 overflow-y-auto">
        {tab === "positions" && <PositionsView />}
        {tab === "orders" && <OrdersView />}
        {tab === "history" && <HistoryList />}
        {tab === "activity" && <Activity />}
      </div>
    </section>
  );
}
