"use client";

/** What is under way: payouts to claim first, since they need the trader, then the withdrawal queue. */

import { useId } from "react";

import { useConsole } from "./ConsoleProvider";
import { Payouts } from "./Payouts";
import { PendingDeposits } from "./PendingDeposits";
import { WithdrawalQueue } from "./WithdrawalQueue";

/** The In progress column: deposits on their way, claims, then the queue. */
export function InProgress() {
  const { signatures } = useConsole();
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-ink-1">
      <h3 id={`${id}-title`} className="px-4 py-3 text-label tracking-caps text-glow uppercase">In progress</h3>
      <PendingDeposits />
      {signatures === "checked" && <Payouts />}
      <WithdrawalQueue />
    </section>
  );
}
