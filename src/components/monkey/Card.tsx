"use client";

/** A titled card on the MONKEY page, labelled by its heading. */

import type { ReactNode } from "react";

/**
 * Moves focus to a card's heading, where a button that just did its work has left the page, once
 * its action is over. Focus the visitor has since moved elsewhere (another field, another card) is
 * left where it is: only focus that is lost, or still inside this card, is taken.
 */
export function focusHeading(id: string): void {
  const heading = document.getElementById(id);
  const active = document.activeElement;
  if (heading === null) return;
  if (active === null || active === document.body || heading.closest("section")?.contains(active)) heading.focus();
}

export function Card({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl border border-line-2 bg-ink-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} tabIndex={-1} className="text-label tracking-caps text-fg-3 uppercase outline-none">{title}</h3>
        {aside}
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}
