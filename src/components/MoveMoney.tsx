"use client";

/** The funding page's one money panel: Deposit and Withdraw tabs, one form at a time. */

import { useId, useState } from "react";

import { tabAfterKey } from "@/lib/tabs";

import { useConsole } from "./ConsoleProvider";
import { DepositForm } from "./DepositForm";
import { EligibilityCard } from "./EligibilityCard";
import { FaucetCard } from "./FaucetCard";
import { WithdrawForm } from "./WithdrawForm";

const TABS = [
  { id: "deposit", label: "Deposit" },
  { id: "withdraw", label: "Withdraw" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Both forms stay mounted, so an amount typed in one survives a look at the other. */
export function MoveMoney() {
  const { signatures } = useConsole();
  const [tab, setTab] = useState<Tab>("deposit");
  const id = useId();
  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = tabAfterKey(event.key, TABS.findIndex((t) => t.id === tab), TABS.length);
    const target = next === null ? undefined : TABS[next];
    if (!target) return;
    event.preventDefault();
    setTab(target.id);
    document.getElementById(`${id}-${target.id}`)?.focus();
  };
  return (
    <section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line-2 bg-ink-1">
      <h3 id={`${id}-title`} className="sr-only">Move money</h3>
      <div role="tablist" aria-label="Move money" className="grid grid-cols-2 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${id}-${t.id}`} tabIndex={tab === t.id ? 0 : -1} aria-selected={tab === t.id} aria-controls={`${id}-${t.id}-panel`} onClick={() => setTab(t.id)} onKeyDown={onKeyDown}
            className={`min-h-11 border-b-2 px-3 py-3 text-label tracking-caps uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:min-h-0 ${tab === t.id ? "border-glow bg-glow/5 text-glow" : "border-transparent text-fg-3 hover:text-fg-2"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-deposit-panel`} aria-labelledby={`${id}-deposit`} hidden={tab !== "deposit"} className="divide-y divide-line">
        {/* The engine takes a first declaration once a deposit is pending; the mock asks for it before the deposit. */}
        {signatures === "checked" ? <><DepositForm step={1} /><EligibilityCard step={2} /></> : <><EligibilityCard step={1} /><DepositForm step={2} /></>}
        <FaucetCard />
      </div>
      <div role="tabpanel" id={`${id}-withdraw-panel`} aria-labelledby={`${id}-withdraw`} hidden={tab !== "withdraw"}>
        <WithdrawForm />
      </div>
    </section>
  );
}
