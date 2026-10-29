"use client";

/** Connects and disconnects the wallet. */

import { useEffect, useId, useRef, useState } from "react";

import { shortHex } from "@/lib/format";
import { connectWallet, disconnectWallet } from "@/lib/store/actions";

import { useConsole, useSession } from "./ConsoleProvider";

const BUTTON = "rounded border border-edge px-3 py-2 text-caption text-fg hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow";

export function WalletButton() {
  const { wallet } = useConsole();
  const { store } = useSession();
  const [open, setOpen] = useState(false);
  const menu = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // The button the user used has been replaced; keep their place by focusing its successor.
    if (moved.current) primary.current?.focus();
    moved.current = false;
  }, [wallet]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      primary.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (wallet) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded border border-line-2 px-2 py-2 text-caption text-fg-2" title={wallet.address}>{shortHex(wallet.address)}</span>
        <button ref={primary} type="button" onClick={() => { moved.current = true; disconnectWallet(store); }} className={BUTTON}>Disconnect</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <button ref={primary} type="button" aria-expanded={open} aria-controls={menu} onClick={() => setOpen(!open)} className={BUTTON}>
        Connect wallet
      </button>
      {open && (
        <ul id={menu} className="absolute right-0 z-50 mt-2 w-64 rounded border border-line-2 bg-ink-2 p-1 shadow-platform">
          {store.deps.wallets.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  moved.current = true;
                  void connectWallet(store, option.id);
                }}
                className="w-full rounded px-3 py-2 text-left hover:bg-glow/10 focus-visible:outline-2 focus-visible:outline-glow"
              >
                <span className="block text-caption text-fg">{option.label}</span>
                <span className="block text-label text-fg-3">{option.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
