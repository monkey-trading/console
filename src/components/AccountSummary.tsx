"use client";

/** The funding page's strip: balance, equity, margin, what is free, and what can be withdrawn now. */

import { formatFixedPlaces, type Fixed } from "@/lib/fixed";
import { shortHex } from "@/lib/format";
import { freeCash, requirementOf, withdrawableOf } from "@/lib/account-figures";

import { useConsole } from "./ConsoleProvider";
import { Notice } from "./Notice";

const usd = (value: Fixed) => `$${formatFixedPlaces(value, 2)}`;

export function AccountSummary() {
  const { account, wallet } = useConsole();
  const cells: [string, string][] = [
    ["Balance", account ? usd(account.balance) : "—"],
    ["Equity", account ? usd(account.equity) : "—"],
    ["Margin", account ? usd(account.margin) : "—"],
    // From V64 a fill and a withdrawal meet the requirement at the account's tier, which can be above the margin positions hold.
    ...(account?.requirements ? [["Needed to open", usd(requirementOf(account))] as [string, string]] : []),
    ["Free", account ? usd(freeCash(account)) : "—"],
    ["Withdrawable now", account ? usd(withdrawableOf(account)) : "—"],
  ];
  return (
    <section aria-label="Account summary" className="overflow-hidden rounded-xl border border-line-2 bg-line">
      <dl className={`grid grid-cols-2 gap-px ${cells.length > 5 ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        {cells.map(([label, value], index) => (
          <div key={label} className={`bg-ink-1 px-4 py-3 ${index === cells.length - 1 && cells.length % 2 === 1 ? "max-lg:col-span-2" : ""}`}>
            <dt className="text-label tracking-caps text-fg-3 uppercase">{label}</dt>
            <dd className="mt-1 break-all text-data text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="bg-ink-1 px-4 has-[p]:pb-3"><Notice surface="accountRead" /></div>
      {wallet && <p className="bg-ink-1 px-4 py-2 text-caption text-fg-3 sm:hidden">Wallet <span className="text-fg-2">{shortHex(wallet.address)}</span></p>}
    </section>
  );
}
