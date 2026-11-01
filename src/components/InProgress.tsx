"use client";

/** What is under way: payouts to claim first, since they need the trader, then the withdrawal queue. */

import { useConsole } from "./ConsoleProvider";
import { Payouts } from "./Payouts";
import { WithdrawalQueue } from "./WithdrawalQueue";

export function InProgress() {
  const { signatures } = useConsole();
  return (
    <section aria-labelledby="progress-title" className="divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-ink-1">
      <h3 id="progress-title" className="px-4 py-3 text-label tracking-caps text-glow uppercase">In progress</h3>
      {signatures === "checked" && <Payouts />}
      <WithdrawalQueue />
    </section>
  );
}
