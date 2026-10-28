"use client";

/** Balance, equity, margin and what is free, for the connected account. */

import { formatFixedPlaces, type Fixed } from "@/lib/fixed";

import { useConsole } from "./ConsoleProvider";

const usd = (value: Fixed) => `$${formatFixedPlaces(value, 2)}`;

export function AccountSummary() {
  const { account, wallet } = useConsole();
  const free = account ? account.equity - account.margin : 0n;
  const cells: [string, string][] = [
    ["Balance", account ? usd(account.balance) : "—"],
    ["Equity", account ? usd(account.equity) : "—"],
    ["Margin used", account ? usd(account.margin) : "—"],
    ["Free margin", account ? usd(free < 0n ? 0n : free) : "—"],
    ["Awaiting finality", account ? usd(account.unfinalised) : "—"],
  ];
  return (
    <section aria-label="Account summary" className="rounded-xl border border-line-2 bg-ink-1">
      <dl className="grid grid-cols-2 divide-x divide-y divide-line">
        {cells.map(([label, value]) => (
          <div key={label} className="px-4 py-4">
            <dt className="text-label tracking-caps text-fg-3 uppercase">{label}</dt>
            <dd className="mt-2 text-data">{value}</dd>
          </div>
        ))}
      </dl>
      {!wallet && <p className="border-t border-line px-4 py-3 text-caption text-fg-3">Connect a wallet to see your account.</p>}
    </section>
  );
}
