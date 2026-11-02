"use client";

/** The chart controls: a compact select. */

import { useId } from "react";

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
