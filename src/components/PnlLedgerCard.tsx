"use client";

/** One ledger row as a card, below 1024 px. Memoised, so a price patch redraws none of them. */

import { memo } from "react";

import type { LedgerItem } from "@/lib/ledger-share";
import { rowTexts } from "@/lib/ledger-cell";
import type { LedgerState } from "@/lib/store/ledger";

export interface LedgerRowProps {
  item: LedgerItem;
  symbol: string;
  places: number;
  scheduleStatus: LedgerState["scheduleStatus"];
}

export const PnlLedgerCard = memo(function PnlLedgerCard({ item, symbol, places, scheduleStatus }: LedgerRowProps) {
  const r = rowTexts(item, places, scheduleStatus);
  return (
    <li className="border-b border-line px-4 py-3 text-caption last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <p><span className="text-fg">{symbol}</span> <span className="text-fg-2">{r.closed}</span>{r.liquidation && <span className="text-ember"> Liquidated</span>}</p>
        <p className={r.loss ? "text-ember" : "text-glow"}><span className="sr-only">Realised profit and loss </span>{r.pnl}</p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-fg-2">
        <div><dt className="text-label text-fg-3">Time</dt><dd><time>{r.time}</time></dd></div>
        <div><dt className="text-label text-fg-3">Contracts</dt><dd>{r.qty}</dd></div>
        <div><dt className="text-label text-fg-3">Price</dt><dd>{r.price}</dd></div>
        <div><dt className="text-label text-fg-3">Profit fee</dt><dd>{r.fee}</dd></div>
        {r.monkey && <div className="col-span-2"><dt className="text-label text-fg-3">MONKEY</dt><dd title={r.monkey.title}>{r.monkey.text}</dd></div>}
      </dl>
    </li>
  );
});
