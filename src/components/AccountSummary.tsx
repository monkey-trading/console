"use client";

/** The funding page's strip: balance, equity, margin, what is free, and what can be withdrawn now. */

import { formatFixedPlaces, type Fixed } from "@/lib/fixed";
import { shortHex } from "@/lib/format";
import { withdrawableNow } from "@/lib/vault";

import { useConsole } from "./ConsoleProvider";

const usd = (value: Fixed) => `$${formatFixedPlaces(value, 2)}`;

export function AccountSummary() {
  const { account, wallet } = useConsole();
  const free = account ? account.equity - account.margin : 0n;
  const cells: [string, string][] = [
    ["Balance", account ? usd(account.balance) : "—"],
    ["Equity", account ? usd(account.equity) : "—"],
    ["Margin", account ? usd(account.margin) : "—"],
    ["Free", account ? usd(free < 0n ? 0n : free) : "—"],
    ["Withdrawable now", account ? usd(withdrawableNow(account.balance, account.equity, account.margin, account.unfinalised)) : "—"],
  ];
  return (
    <section aria-label="Account summary" className="overflow-hidden rounded-xl border border-line-2 bg-line">
      <dl className="grid grid-cols-2 gap-px sm:grid-cols-5">
        {cells.map(([label, value], index) => (
          <div key={label} className={`bg-ink-1 px-4 py-3 ${index === cells.length - 1 ? "max-sm:col-span-2" : ""}`}>
            <dt className="text-label tracking-caps text-fg-3 uppercase">{label}</dt>
            <dd className="mt-1 text-data text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      {wallet && <p className="bg-ink-1 px-4 py-2 text-caption text-fg-3 sm:hidden">Wallet <span className="text-fg-2">{shortHex(wallet.address)}</span></p>}
    </section>
  );
}
