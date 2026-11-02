"use client";

/** One ledger row of the table, from 1024 px. Memoised, so a price patch redraws none of them. */

import { memo } from "react";

import { rowTexts } from "@/lib/ledger-cell";

import type { LedgerRowProps } from "./PnlLedgerCard";

export const PnlLedgerTableRow = memo(function PnlLedgerTableRow({ item, symbol, places, scheduleStatus }: LedgerRowProps) {
  const r = rowTexts(item, places, scheduleStatus);
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-4 py-4 whitespace-nowrap text-fg-3"><time>{r.time}</time></td>
      <td className="px-4 py-4 text-fg">{symbol}</td>
      <td className="px-4 py-4 text-fg-2">{r.closed}{r.liquidation && <span className="text-ember"> · Liquidated</span>}</td>
      <td className="px-4 py-4">{r.qty}</td>
      <td className="px-4 py-4">{r.price}</td>
      <td className={`px-4 py-4 ${r.loss ? "text-ember" : "text-glow"}`}>{r.pnl}</td>
      <td className="px-4 py-4">{r.fee}</td>
      <td className="px-4 py-4" title={r.monkey?.title}>{r.monkey?.text}</td>
    </tr>
  );
});
