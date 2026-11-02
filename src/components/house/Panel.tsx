"use client";

/** The House page's building blocks: a compact panel, a label that explains itself on hover and focus, and a figure row. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { placeTooltip, type Spot } from "@/lib/tooltip";

export const PANEL_TITLE = "text-label tracking-caps text-fg-2 uppercase";

/** A compact panel: a title bar with optional controls, and a body that fills the rest of its cell. */
export function Panel({ title, tip, controls, children, className = "" }: { title: string; tip?: string; controls?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col border border-line bg-ink-1 ${className}`}>
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
        <h3 id={id} className={PANEL_TITLE}>{tip === undefined ? title : <Term label={title} tip={tip} />}</h3>
        {controls !== undefined && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">{children}</div>
    </section>
  );
}

/**
 * A label that says what it means. The explanation shows while the pointer is over the label or its
 * explanation (the two touch, so the pointer can cross from one to the other), or while the label
 * has focus. Escape dismisses it without moving focus. It is placed against the viewport, below the
 * label or above it when there is no room, and follows the label when the page scrolls.
 */
export function Term({ label, tip }: { label: string; tip: string }) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const place = () => {
    const box = anchor.current?.getBoundingClientRect();
    setSpot(box === undefined ? null : placeTooltip(box, { width: window.innerWidth, height: window.innerHeight }));
  };
  const show = (el: HTMLElement) => {
    anchor.current = el;
    place();
  };
  const open = spot !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSpot(null);
    };
    const follow = () => {
      const box = anchor.current?.getBoundingClientRect();
      setSpot(box === undefined ? null : placeTooltip(box, { width: window.innerWidth, height: window.innerHeight }));
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", follow, true);
    };
  }, [open]);
  return (
    <span role="presentation" className="inline-flex" onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={() => setSpot(null)}>
      <button type="button" aria-describedby={id} onFocus={(event) => show(event.currentTarget)} onBlur={() => setSpot(null)} className="cursor-help border-b border-dotted border-edge text-left hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow">
        {label}
      </button>
      <span id={id} role="tooltip" hidden={!open} style={spot ?? undefined} className="fixed z-30 text-left text-caption leading-snug tracking-normal text-fg-2 normal-case">
        <span className={`block ${spot?.bottom === undefined ? "pt-1" : "pb-1"}`}>
          <span className="block rounded border border-line-2 bg-ink-2 p-2 shadow-platform">{tip}</span>
        </span>
      </span>
    </span>
  );
}

const TONES = { fg: "text-fg", glow: "text-glow", ember: "text-ember", muted: "text-fg-3" } as const;
export type Emphasis = keyof typeof TONES;

/** One labelled figure in a panel's list. */
export function Row({ label, tip, value, tone = "fg" }: { label: string; tip: string; value: ReactNode; tone?: Emphasis }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-data">
      <dt className="text-caption text-fg-3"><Term label={label} tip={tip} /></dt>
      <dd className={`min-w-0 text-right tabular-nums ${TONES[tone]}`}>{value}</dd>
    </div>
  );
}

/** What a panel says in place of a figure or chart it cannot show: one calm line, never an alarm. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="m-auto max-w-prose px-2 py-6 text-center text-caption text-fg-3">{children}</p>;
}
