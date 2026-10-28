"use client";

/** The funding panel: a modal drawer with the balance, eligibility, deposit, withdrawal and queue. */

import { useEffect, useRef } from "react";

import { AccountSummary } from "./AccountSummary";
import { useConsole, useSession } from "./ConsoleProvider";
import { EligibilityCard } from "./EligibilityCard";
import { DepositForm, WithdrawForm } from "./FundsForms";
import { WalletButton } from "./WalletButton";
import { WithdrawalQueue } from "./WithdrawalQueue";

export function FundingDrawer() {
  const { fundingOpen, wallet } = useConsole();
  const { store } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (fundingOpen && !el.open) el.showModal();
    if (!fundingOpen && el.open) el.close();
  }, [fundingOpen]);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // A click on the backdrop lands on the dialog element itself, not on its content.
    const onClick = (event: MouseEvent) => event.target === el && store.setFundingOpen(false);
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [store]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="funding-title"
      onClose={() => store.setFundingOpen(false)}
      className="m-0 ml-auto h-dvh max-h-dvh w-[min(30rem,100vw)] max-w-none overflow-y-auto border-l border-line-2 bg-ink-1 p-0 text-fg backdrop:bg-ink/70"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="funding-title" className="text-label tracking-caps text-glow uppercase">Funding</h2>
        <button type="button" onClick={() => store.setFundingOpen(false)} className="rounded border border-line-2 px-3 py-1.5 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Close</button>
      </div>
      <div className="space-y-5 p-5">
        <AccountSummary />
        {!wallet && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line-2 p-4">
            <p className="text-caption text-fg-2">Your wallet signs every order and withdrawal and sends deposits to the vault.</p>
            <WalletButton />
          </div>
        )}
        <EligibilityCard />
        <DepositForm />
        <WithdrawForm />
        <WithdrawalQueue />
      </div>
    </dialog>
  );
}
