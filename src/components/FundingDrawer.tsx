"use client";

/** The funding panel: a modal drawer with the balance, eligibility, deposit, withdrawal and queue. */

import { useEffect, useRef } from "react";

import { AccountSummary } from "./AccountSummary";
import { useConsole, useSession } from "./ConsoleProvider";
import { EligibilityCard } from "./EligibilityCard";
import { DepositForm } from "./DepositForm";
import { ToastList } from "./ToastList";
import { WalletButton } from "./WalletButton";
import { WithdrawForm } from "./WithdrawForm";
import { WithdrawalQueue } from "./WithdrawalQueue";

export function FundingDrawer() {
  const { fundingOpen, wallet, toasts } = useConsole();
  const { store } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const connected = useRef(wallet !== null);
  useEffect(() => {
    // Connecting from the drawer removes the button that was used; focus moves to the drawer's heading.
    if (fundingOpen && wallet !== null && !connected.current) document.getElementById("funding-title")?.focus();
    connected.current = wallet !== null;
  }, [wallet, fundingOpen]);
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
    const onClick = (event: MouseEvent) => {
      // The dialog element is the panel itself, so a click on the backdrop is one outside its box.
      const box = el.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (event.target === el && outside) store.setFundingOpen(false);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [store]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="funding-title"
      onClose={() => store.setFundingOpen(false)}
      className="m-0 ml-auto h-dvh max-h-dvh w-screen max-w-none scroll-pt-16 overflow-y-auto border-line-2 lg:w-[min(30rem,100vw)] lg:border-l bg-ink-1 p-0 text-fg backdrop:bg-ink/70"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-ink-1 px-4 py-2 lg:px-5 lg:py-4">
        <h2 id="funding-title" tabIndex={-1} className="text-label tracking-caps text-glow uppercase outline-none">Funding</h2>
        <button type="button" onClick={() => store.setFundingOpen(false)} className="min-h-11 rounded border border-line-2 px-4 py-1.5 text-caption text-fg-2 lg:min-h-0 lg:px-3 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow">Close</button>
      </div>
      {/* The page behind a modal is inert, so the drawer announces results itself. */}
      <div role="status" aria-live="polite" className="sr-only">
        {/* Keyed by message, so a result whose text repeats the last is still announced. */}
        <p key={toasts[toasts.length - 1]?.id ?? 0}>{toasts[toasts.length - 1]?.text ?? ""}</p>
      </div>
      <div className="space-y-5 p-4 lg:p-5">
        <ToastList focusId="funding-title" />
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
