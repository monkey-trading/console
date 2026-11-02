"use client";

/** The deposits sent from the wallet that the node has not credited yet, from the send until the node's receipt for each. */

import { formatUsdc } from "@/lib/vault";

import { useConsole } from "./ConsoleProvider";

/** Nothing when none is waiting. The store reads the vault's own deposit events at each connect, so a reload does not lose one still waiting. */
export function PendingDeposits() {
  const { pendingDeposits } = useConsole();
  if (pendingDeposits.length === 0) return null;
  return (
    <section aria-labelledby="pending-deposits-title" className="p-4">
      <h4 id="pending-deposits-title" className="text-label tracking-caps text-fg-3 uppercase">Deposits on their way</h4>
      <ul role="status" className="mt-3 space-y-2">
        {pendingDeposits.map((deposit, index) => (
          <li key={deposit.id ?? `sent-${index}`} className="rounded border border-line-2 px-3 py-3 text-caption">
            <p className="flex justify-between gap-2"><span className="text-fg">Deposit</span><span className="text-fg-2">{formatUsdc(deposit.amount)}</span></p>
            <p className="mt-2 text-fg-3">The node credits it a few blocks after it is mined. Your balance rises then.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
