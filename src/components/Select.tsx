"use client";

/** A custom select in the console's style: a button that opens a listbox, usable by keyboard and screen reader. */

import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Hides the label visually while keeping it for assistive technology. */
  hideLabel?: boolean;
}

export function Select<T extends string>({ label, value, options, onChange, hideLabel = false }: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((o) => o.value === value);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    root.current?.querySelector("button")?.focus();
  };

  const onKey = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (event.key === "ArrowDown") setActive(Math.min(active + 1, last));
    else if (event.key === "ArrowUp") setActive(Math.max(active - 1, 0));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || event.key === " ") choose(active);
    else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") root.current?.querySelector("button")?.focus();
      return;
    } else return;
    event.preventDefault();
  };

  return (
    <div ref={root} className="relative">
      <span id={`${id}-label`} className={hideLabel ? "sr-only" : "block text-caption text-fg-2"}>{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-button`}
        id={`${id}-button`}
        onClick={() => {
          setActive(Math.max(selected, 0));
          setOpen(!open);
        }}
        className={`${hideLabel ? "" : "mt-1"} flex w-full items-center justify-between gap-2 rounded border border-line-2 bg-ink px-2 py-2 text-left text-data text-fg hover:border-glow focus-visible:outline-2 focus-visible:outline-glow`}
      >
        <span className="truncate">{options[selected]?.label ?? ""}</span>
        <span aria-hidden="true" className="text-fg-3">▾</span>
      </button>
      {open && (
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-opt-${active}`}
          onKeyDown={onKey}
          className="absolute z-50 mt-1 max-h-64 w-full min-w-40 overflow-y-auto rounded border border-line-2 bg-ink-2 p-1 shadow-platform outline-none"
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
              onMouseEnter={() => setActive(index)}
              className={`rounded px-2 py-2 text-data ${index === active ? "bg-glow/10 text-glow" : "text-fg-2"} ${option.value === value ? "font-medium" : ""}`}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
