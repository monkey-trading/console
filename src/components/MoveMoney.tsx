"use client";

/** The funding page's one money panel: Deposit and Withdraw tabs, one form at a time. */

import { useId, useState } from "react";

import { setupGate } from "@/lib/setup-steps";
import { openSetup } from "@/lib/store/setup";
import { tabAfterKey } from "@/lib/tabs";

import { useConsole, useSession } from "./ConsoleProvider";
import { DepositForm } from "./DepositForm";
import { FaucetCard } from "./FaucetCard";
import { useSignGate } from "./SignGate";
import { WithdrawForm } from "./WithdrawForm";

const TABS = [
  { id: "deposit", label: "Deposit" },
  { id: "withdraw", label: "Withdraw" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Both forms stay mounted, so an amount typed in one survives a look at the other. Until the account has a declaration, the Deposit tab says so instead of showing its form. */
export function MoveMoney() {
  const state = useConsole();
  const { store } = useSession();
  const setup = setupGate(state);
  const [tab, setTab] = useState<Tab>("deposit");
  const id = useId();
  const gate = useSignGate(`${id}-gate`);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = tabAfterKey(event, TABS.findIndex((t) => t.id === tab), TABS.length);
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
        {setup === null && <DepositForm />}
        {/* A node the console does not trust may never answer that read, so why it cannot sign comes first. */}
        {setup === "reading" && <div className="p-4 text-caption text-fg-2">{gate.blocked ? gate.note : "Reading your account…"}</div>}
        {setup === "needed" && (
          <section aria-labelledby={`${id}-setup`} className="p-4">
            <h4 id={`${id}-setup`} className="text-label tracking-caps text-fg-3 uppercase">Deposit USDC</h4>
            <p className="mt-3 text-caption leading-relaxed text-fg-2">You deposit last. First sign the declaration and authorize this browser.</p>
            <button type="button" onClick={() => openSetup(store)} className="mt-4 min-h-11 rounded border border-glow bg-glow/10 px-4 py-2.5 text-caption text-glow hover:bg-glow/20 focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0">Continue setup</button>
          </section>
        )}
        <FaucetCard />
      </div>
      <div role="tabpanel" id={`${id}-withdraw-panel`} aria-labelledby={`${id}-withdraw`} hidden={tab !== "withdraw"}>
        <WithdrawForm />
      </div>
    </section>
  );
}
