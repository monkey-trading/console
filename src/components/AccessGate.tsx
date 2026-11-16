"use client";

/** Replaces every screen with the geo-block when the node refuses the caller's region. */

import { useEffect, useRef, type ReactNode } from "react";

import { useConsole } from "./ConsoleProvider";

const REASON = {
  united_states: "Monkey Trading isn't available to people in the United States.",
  sanctioned_jurisdiction: "Monkey Trading isn't available in sanctioned jurisdictions.",
} as const;

export function AccessGate({ children }: { children: ReactNode }) {
  const { blocked, accessChecked } = useConsole();
  const title = useRef<HTMLHeadingElement>(null);
  /** Whether the first access check had finished before the render this effect follows. */
  const checked = useRef(false);
  // A refusal that arrives after the first check replaces the page the user was on, so focus goes to the gate's heading: the focused control is gone, and a screen reader hears the gate. The first check, at page load, takes no focus.
  useEffect(() => {
    if (blocked !== null && checked.current) title.current?.focus();
    checked.current = accessChecked;
  }, [blocked, accessChecked]);
  if (blocked === null) return children;
  return (
    <section aria-labelledby="blocked-title" className="mx-auto max-w-xl rounded-xl border border-ember/50 bg-ink-1 p-8 text-center">
      <p className="text-label tracking-caps text-ember uppercase">Not available</p>
      <h2 id="blocked-title" ref={title} tabIndex={-1} className="mt-3 text-lg tracking-tight outline-none">This service isn&apos;t available where you are</h2>
      <p className="mt-4 text-data leading-relaxed text-fg-2">{REASON[blocked]}</p>
      <p className="mt-4 text-caption leading-relaxed text-fg-3">
        This is based on where you&apos;re connecting from. Orders, withdrawals and declarations from here are refused, and deposits sent directly to the vault are checked against the sending address. This app can&apos;t change it.
      </p>
    </section>
  );
}
