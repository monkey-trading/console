"use client";

/** Results of the user's actions: shown above everything, announced politely, dismissed on request. */

import { useEffect, useRef } from "react";

import { useConsole, useSession } from "./ConsoleProvider";

const TONE = { ok: "border-glow/50 text-glow", error: "border-alarm/60 text-alarm", info: "border-line-2 text-fg" } as const;

/** How long a message stays, in milliseconds. */
const TOAST_MS = 7_000;

export function Toasts() {
  const { toasts } = useConsole();
  const { store } = useSession();
  const popover = useRef<HTMLDivElement>(null);
  const latest = toasts[toasts.length - 1]?.id ?? 0;
  useEffect(() => {
    const el = popover.current;
    if (!el) return;
    // Showing the popover again lifts it above an open dialog, such as the funding drawer.
    if (el.matches(":popover-open")) el.hidePopover();
    if (latest !== 0) el.showPopover();
  }, [latest]);
  useEffect(() => {
    if (latest === 0) return;
    const timer = setTimeout(() => store.clearToasts(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [latest, store]);
  return (
    <>
      <div role="log" aria-live="polite" aria-label="Notifications" className="sr-only">
        {toasts.map((toast) => <p key={toast.id}>{toast.text}</p>)}
      </div>
      <div ref={popover} popover="manual" className="fixed inset-auto bottom-12 left-1/2 m-0 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 overflow-visible border-0 bg-transparent p-0">
        <div className="flex flex-col gap-2" aria-hidden="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`flex items-start justify-between gap-3 rounded border bg-ink-2 px-3 py-3 text-caption shadow-platform ${TONE[toast.tone]}`}>
              <p className="min-w-0 break-words">{toast.text}</p>
              <button type="button" tabIndex={-1} onClick={() => store.dismissToast(toast.id)} aria-label="Dismiss notification" className="shrink-0 text-fg-3 hover:text-fg">×</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
