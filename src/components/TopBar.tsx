"use client";

/** The workspace's top strip: brand, account summary, funding, wallet, node clock and mock controls. */

import { formatFixedPlaces, type Fixed } from "@/lib/fixed";
import { formatClock } from "@/lib/time";

import { useConsole, useSession } from "./ConsoleProvider";
import { LogoMark } from "./Logo";
import { MockControls } from "./MockControls";
import { WalletButton } from "./WalletButton";

const usd = (value: Fixed) => `$${formatFixedPlaces(value, 2)}`;
const BUTTON = "rounded border border-edge px-3 py-2 text-caption text-fg hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

export function TopBar() {
  const { account, now } = useConsole();
  const { store } = useSession();
  const free = account ? account.equity - account.margin : 0n;
  const stats: [string, string, string][] = [
    ["Equity", account ? usd(account.equity) : "—", ""],
    ["Balance", account ? usd(account.balance) : "—", "hidden md:block"],
    ["Margin", account ? usd(account.margin) : "—", "hidden sm:block"],
    ["Free", account ? usd(free < 0n ? 0n : free) : "—", "hidden lg:block"],
  ];
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-6">
      <h1 className="flex items-center gap-3 text-caption font-normal">
        <LogoMark className="size-8" />
        <span>MONKEY TRADING <span className="hidden text-fg-3 sm:inline">/ CONSOLE</span></span>
      </h1>
      <dl className="flex items-center gap-5" aria-label="Account summary">
        {stats.map(([label, value, hide]) => (
          <div key={label} className={hide}>
            <dt className="text-label tracking-caps text-fg-3 uppercase">{label}</dt>
            <dd className="text-caption text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden text-label tracking-caps text-fg-3 uppercase xl:inline">
          Node clock <span aria-hidden="true" className="text-fg-2">{formatClock(now)} UTC</span>
        </span>
        <button type="button" onClick={() => store.setFundingOpen(true)} className={BUTTON}>Funding</button>
        <WalletButton />
        <MockControls />
      </div>
    </header>
  );
}
