"use client";

/** The funding page: the account's figures, the panel that moves money, what is under way, then MONKEY and what the wallet signs for. */

import Link from "next/link";

import { AccountSummary } from "./AccountSummary";
import { useConsole } from "./ConsoleProvider";
import { EmissionsCard } from "./EmissionsCard";
import { InProgress } from "./InProgress";
import { MoveMoney } from "./MoveMoney";
import { SigningFor } from "./SigningFor";

/** Funding screen; the console's layout supplies the provider, the access gate and the shell. */
export function FundingPage() {
  const { wallet, signatures } = useConsole();
  return (
    // Keyboard scrolling needs a tab stop on the scroll container, as on the House page.
    <div role="region" aria-label="Funding details" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lead tracking-caps text-glow uppercase">Funding</h2>
          <Link href="/" className="inline-flex min-h-11 items-center text-caption text-fg-2 underline hover:text-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0">Back to trading</Link>
        </div>
        {!wallet && <p className="rounded-xl border border-line-2 p-4 text-caption text-fg-2">Connect a wallet from the top bar. It authorizes trading with one signature — the orders then sign in the browser — and it signs each withdrawal and sends each deposit to the vault.</p>}
        <AccountSummary />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <MoveMoney />
          <InProgress />
        </div>
        <EmissionsCard />
        {signatures === "checked" && <SigningFor />}
      </div>
    </div>
  );
}
