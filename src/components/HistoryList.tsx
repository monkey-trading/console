"use client";

/** The account's events from the node's history, newest first. */

import type { EngineEvent } from "@/lib/engine/types";
import { describeEvent } from "@/lib/messages";
import { formatStamp } from "@/lib/time";

import { useConsole } from "./ConsoleProvider";

const KIND: Partial<Record<EngineEvent["type"], string>> = {
  fill: "Fill", close_out: "Close-out", deposited: "Deposit", withdrawal_approved: "Withdrawal", withdrawal_queued: "Withdrawal",
  withdrawal_queue_updated: "Withdrawal", withdrawal_rejected: "Withdrawal", order_rejected: "Order", order_cancelled: "Order",
  eligibility_attested: "Eligibility", eligibility_rejected: "Eligibility", financing: "Financing", bad_debt: "Close-out",
};

export function HistoryList() {
  const { history, markets, wallet } = useConsole();
  const symbolOf = (id: number) => markets.find((m) => m.id === id)?.symbol ?? `market ${id}`;
  const rows = history.flatMap((entry) => {
    const text = describeEvent(entry, symbolOf);
    return text === null ? [] : [{ entry, text }];
  });
  return (
    <div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-caption text-fg-3">{wallet ? "Nothing yet. Fills, deposits and withdrawals appear here." : "Connect a wallet to see your history."}</p>
      ) : (
        <ol>
          {rows.map(({ entry, text }) => (
            <li key={entry.cursor} className="grid grid-cols-[7.5rem_6.5rem_1fr] gap-3 border-b border-line px-4 py-3 text-caption last:border-b-0">
              <time className="text-fg-3">{formatStamp(entry.ts)}</time>
              <span className="text-fg-2">{KIND[entry.type] ?? "Event"}</span>
              <span className={entry.type === "close_out" || entry.type.endsWith("rejected") || entry.type === "bad_debt" ? "text-ember" : "text-fg"}>{text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
