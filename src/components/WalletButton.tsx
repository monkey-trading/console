"use client";

/** Connects and disconnects the wallet. */

import { useEffect, useId, useRef, useState } from "react";

import { shortHex } from "@/lib/format";
import { clearChoice } from "@/lib/engine/wallet-persist";
import { connectWallet, disconnectWallet } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";
import { useEscapeClose } from "./use-escape-close";

const BUTTON = "min-h-11 rounded border border-edge px-2.5 py-2 sm:px-3 lg:min-h-0 text-caption text-fg hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

export function WalletButton() {
  const { wallet } = useConsole();
  const { store, persistence } = useSession();
  const [open, setOpen] = useState(false);
  const menu = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // The button the user used has been replaced; keep their place by focusing its successor.
    if (moved.current) primary.current?.focus();
    moved.current = false;
  }, [wallet]);
  useEscapeClose(open, root, () => {
    setOpen(false);
    primary.current?.focus();
  });
  if (wallet) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden rounded border border-line-2 px-2 py-2.5 text-caption text-fg-2 sm:inline lg:py-2" title={wallet.address}>{shortHex(wallet.address)}</span>
        <button ref={primary} type="button" onClick={() => { moved.current = true; if (persistence !== null) clearChoice(persistence); disconnectWallet(store); }} className={BUTTON}>Disconnect</button>
      </div>
    );
  }
  return (
    <div ref={root} className="relative">
      <button ref={primary} type="button" aria-expanded={open} aria-controls={menu} onClick={() => setOpen(!open)} className={BUTTON}>
        Connect wallet
      </button>
      {open && (
        <ul id={menu} className="fixed inset-x-4 bottom-4 z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded border sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:mt-2 sm:max-h-none sm:w-64 sm:overflow-visible border-line-2 bg-ink-2 p-1 shadow-platform">
          <li className="sm:hidden"><button type="button" onClick={() => { setOpen(false); primary.current?.focus(); }} className={`${BUTTON} w-full`}>Close wallet choices</button></li>
          {store.deps.wallets.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  // The menu closes; keep focus on the button, so a pairing dialog that closes returns it there.
                  primary.current?.focus();
                  moved.current = true;
                  void connectWallet(store, option.id);
                }}
                className="min-h-11 w-full rounded px-3 py-2 text-left hover:bg-glow/10 focus-visible:outline-2 focus-visible:outline-glow"
              >
                <span className="flex items-center gap-2 text-caption text-fg">
                  {/* The label names the option, so the logo beside it is decorative. */}
                  {option.icon !== undefined && <img src={option.icon} alt="" width={16} height={16} className="size-4" />}
                  {option.label}
                </span>
                <span className="block text-label text-fg-3">{option.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
