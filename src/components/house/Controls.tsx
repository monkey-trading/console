"use client";

/** The chart controls: a compact select, and the Live switch that makes a chart read every few seconds. */

import { useId } from "react";

import { LIVE_EVERY_MS } from "@/lib/store/house-feeds";

const FIELD = "min-h-6 rounded border border-line-2 bg-ink px-1.5 py-0.5 text-caption text-fg hover:border-glow focus-visible:outline-2 focus-visible:outline-glow max-lg:min-h-11";

/** A native select with a label only a screen reader needs: the panel's title says what it chooses. */
export function Pick<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((o) => String(o.value) === event.target.value);
          if (picked !== undefined) onChange(picked.value);
        }}
        className={FIELD}
      >
        {options.map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
      </select>
    </>
  );
}

/** The Live switch: on, the chart reads again every few seconds instead of every half minute. */
export function LiveToggle({ live, onChange }: { live: boolean; onChange: (live: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      aria-label={`Live, reading every ${LIVE_EVERY_MS / 1000} seconds`}
      onClick={() => onChange(!live)}
      className={`min-h-6 rounded border px-1.5 py-0.5 text-caption uppercase focus-visible:outline-2 focus-visible:outline-glow max-lg:min-h-11 ${live ? "border-glow text-glow" : "border-line-2 text-fg-3 hover:border-glow hover:text-fg"}`}
    >
      Live
    </button>
  );
}
