"use client";

/** The workspace's top strip: the name and page links on the left; the node clock, mock controls, account figures and wallet on the right. */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { formatFixedPlaces, type Fixed } from "@/lib/fixed";
import { isCurrentPage, PAGES } from "@/lib/nav";
import { formatClock } from "@/lib/time";

import { useConsole, useSession } from "./ConsoleProvider";
import { LogoMark } from "./Logo";
import { MockControls } from "./MockControls";
import { WalletButton } from "./WalletButton";

const usd = (value: Fixed) => `$${formatFixedPlaces(value, 2)}`;
const BUTTON = "min-h-11 rounded border border-edge px-2.5 py-2 sm:px-3 lg:min-h-0 text-caption text-fg hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";
const NAV_LINK = "inline-flex min-h-11 items-center px-1.5 text-caption uppercase focus-visible:outline-2 focus-visible:outline-glow lg:min-h-6";
const NAV_ITEM = `${NAV_LINK} text-fg-3 hover:text-fg`;
const NAV_CURRENT = `${NAV_LINK} text-glow`;

export function TopBar() {
  const { account, now, paused } = useConsole();
  const { store, node } = useSession();
  const pathname = usePathname();
  const free = account ? account.equity - account.margin : 0n;
  const stats: [string, string, string][] = [
    ["Equity", account ? usd(account.equity) : "—", ""],
    ["Balance", account ? usd(account.balance) : "—", "hidden md:block"],
    ["Margin", account ? usd(account.margin) : "—", "hidden sm:block"],
    ["Free", account ? usd(free < 0n ? 0n : free) : "—", "hidden lg:block"],
  ];
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-caption font-normal">
          <Link href="/" aria-label="Monkey Trading console, back to the trading terminal" className="flex min-h-11 items-center gap-3 text-fg focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0">
            <LogoMark className="size-8" />
            <span>MONKEY TRADING</span>
          </Link>
        </h1>
        <span aria-hidden="true" className="hidden text-caption text-fg-3 sm:inline">/</span>
        <nav aria-label="Pages" className="flex items-center gap-1 sm:gap-2">
          {PAGES.map(({ href, label }) => {
            const current = isCurrentPage(pathname, href);
            return (
              <Link key={href} href={href} aria-current={current ? "page" : undefined} className={current ? NAV_CURRENT : NAV_ITEM}>{label}</Link>
            );
          })}
        </nav>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <span className="hidden text-label tracking-caps text-fg-3 uppercase xl:inline">
          Node clock <span aria-hidden="true" className="text-fg-2">{now === 0 ? "—" : `${formatClock(now)} UTC`}</span>
        </span>
        {node && <button type="button" onClick={() => store.setPaused(!paused)} className={BUTTON}>{paused ? "Play" : "Pause"}<span className="sr-only"> the simulation</span></button>}
        <MockControls />
        <dl className="flex items-center gap-5" aria-label="Account summary">
          {stats.map(([label, value, hide]) => (
            <div key={label} className={hide}>
              <dt className="text-label tracking-caps text-fg-3 uppercase">{label}</dt>
              <dd className="text-caption text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <WalletButton />
      </div>
    </header>
  );
}
