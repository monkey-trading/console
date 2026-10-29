"use client";

/** The phone's bar at the foot of the screen: one button per pane of the workspace. Hidden from 1024 px. */

import { useEffect, useRef } from "react";

import { useConsole } from "./ConsoleProvider";

const PHONE_PANES = [
  { id: "markets", label: "Markets" },
  { id: "chart", label: "Chart" },
  { id: "trade", label: "Trade" },
  { id: "account", label: "Account" },
] as const;

/** The pane ids, for matching a DOM attribute. */
export const PHONE_PANE_IDS: readonly string[] = PHONE_PANES.map((p) => p.id);

export type PhonePane = (typeof PHONE_PANES)[number]["id"];

export function PhoneNav({ pane, onChange }: { pane: PhonePane; onChange: (pane: PhonePane) => void }) {
  const { account } = useConsole();
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    // Larger text wraps the labels onto more rows, so the page clears the bar's real height.
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--bar-height", `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bar-height");
    };
  }, []);
  const open = account ? account.positions.length + account.orders.length : 0;
  return (
    <nav ref={bar} aria-label="Terminal views" data-phone-nav="" className="fixed inset-x-0 bottom-0 z-30 min-h-bar border-t border-line-2 bg-ink-1 lg:hidden">
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))]">
        {PHONE_PANES.map(({ id, label }) => (
          <li key={id}>
            <button
              type="button"
              aria-current={pane === id ? "page" : undefined}
              onClick={() => onChange(id)}
              className={`flex min-h-bar w-full flex-wrap content-center items-center justify-center gap-x-1 border-t-2 text-label tracking-caps uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow ${pane === id ? "border-t-glow bg-glow/5 text-glow" : "border-t-transparent text-fg-3"}`}
            >
              {label}
              {id === "account" && open > 0 && <span className="text-fg-2">({open}<span className="sr-only"> open positions and orders</span>)</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
