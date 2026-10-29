"use client";

/** The phone's bar at the foot of the screen: one button per pane of the workspace. Hidden from 1024 px. */

import { useConsole } from "./ConsoleProvider";

export const PHONE_PANES = [
  { id: "markets", label: "Markets" },
  { id: "chart", label: "Chart" },
  { id: "trade", label: "Trade" },
  { id: "account", label: "Account" },
] as const;

export type PhonePane = (typeof PHONE_PANES)[number]["id"];

export function PhoneNav({ pane, onChange }: { pane: PhonePane; onChange: (pane: PhonePane) => void }) {
  const { account } = useConsole();
  const open = account ? account.positions.length + account.orders.length : 0;
  return (
    <nav aria-label="Terminal views" data-phone-nav="" className="fixed inset-x-0 bottom-0 z-30 h-14 border-t border-line-2 bg-ink-1 lg:hidden">
      <ul className="grid h-full grid-cols-4">
        {PHONE_PANES.map(({ id, label }) => (
          <li key={id} className="h-full">
            <button
              type="button"
              aria-current={pane === id ? "page" : undefined}
              onClick={() => onChange(id)}
              className={`flex h-full w-full flex-wrap content-center items-center justify-center gap-x-1 border-t-2 text-label tracking-caps uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow ${pane === id ? "border-t-glow bg-glow/5 text-glow" : "border-t-transparent text-fg-3"}`}
            >
              {label}
              {id === "account" && open > 0 && <span className="text-fg-2">({open})</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
