"use client";

/** The wallet's pending request and the results of the user's actions: shown above everything, announced politely, results dismissed on request. */

import { useEffect, useRef } from "react";

import { useConsole, useSession } from "./ConsoleProvider";
import { ToastList } from "./ToastList";
import { ToastLog } from "./ToastLog";

/** How long a message stays, in milliseconds. */
const TOAST_MS = 7_000;

export function Toasts() {
  const { toasts, prompt } = useConsole();
  const { store } = useSession();
  const popover = useRef<HTMLDivElement>(null);
  const latest = toasts[toasts.length - 1]?.id ?? 0;
  const prompting = prompt !== null;
  useEffect(() => {
    const el = popover.current;
    // Browsers without the Popover API still get the announcements below; the messages show in the page flow.
    if (!el || typeof el.showPopover !== "function") return;
    if (el.matches(":popover-open")) el.hidePopover();
    if (latest !== 0 || prompting) el.showPopover();
  }, [latest, prompting]);
  useEffect(() => {
    if (latest === 0) return;
    const timer = setTimeout(() => {
      // A message that expires under the keyboard's focus would drop it; move it somewhere deliberate first.
      if (document.activeElement?.closest("[data-toast]")) document.getElementById("main")?.focus();
      store.clearToasts();
    }, TOAST_MS);
    return () => clearTimeout(timer);
  }, [latest, store]);
  return (
    <>
      <ToastLog toasts={toasts} />
      <div ref={popover} popover="manual" className="fixed inset-auto bottom-[calc(var(--bar-height,var(--spacing-bar))+1rem)] left-1/2 lg:bottom-12 m-0 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 overflow-visible border-0 bg-transparent p-0">
        <div className="flex flex-col gap-2">
          {/* The wallet's request sits above any result, so a toast never hides what the wallet is asking. */}
          {prompting && <p aria-hidden="true" className="rounded border border-amber/60 bg-ink-2 px-3 py-3 text-caption text-amber shadow-platform">{prompt}</p>}
          <ToastList />
        </div>
      </div>
    </>
  );
}
