"use client";

/** A custom select in the console's style: a button that opens a listbox, usable by keyboard and screen reader. */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { placeListbox } from "@/lib/listbox-placement";

/** The gap kept between an open list and the viewport's edges, in CSS pixels. */
const VIEWPORT_MARGIN = 8;

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Anchors the open listbox to the control's end side, for a control at its container's edge, so the wider list stays inside. */
  align?: "start" | "end";
}

export function Select<T extends string>({ label, value, options, onChange, align = "start" }: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.findIndex((o) => o.value === value);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  // The open list stays inside the viewport whatever the text size or spacing: it is narrowed to the
  // viewport, shifted back from an edge it would cross, and opened above the control when the options
  // do not fit below. Measured on open and again when the viewport changes, so it never relies on page overflow.
  useLayoutEffect(() => {
    const box = list.current;
    const anchor = root.current;
    if (!open || box === null || anchor === null) return;
    const place = () => {
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      box.style.transform = "";
      box.style.maxHeight = "";
      const room = `${Math.max(0, viewport.width - 2 * VIEWPORT_MARGIN)}px`;
      box.style.maxWidth = room;
      // The class's minimum width gives way to the room there is, since a minimum beats a maximum.
      box.style.minWidth = `min(10rem, ${room})`;
      const control = anchor.querySelector("button")?.getBoundingClientRect();
      if (control === undefined) return;
      const placed = placeListbox({ control, list: { width: box.getBoundingClientRect().width, contentHeight: box.scrollHeight }, viewport, margin: VIEWPORT_MARGIN, align });
      box.style.transform = `translateX(${placed.shiftX}px)`;
      box.style.maxHeight = `min(16rem, ${placed.maxHeight}px)`;
      box.style.top = placed.above ? "auto" : "";
      box.style.bottom = placed.above ? "100%" : "";
      box.style.marginTop = placed.above ? "0" : "";
      box.style.marginBottom = placed.above ? "0.25rem" : "";
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, align, options.length]);

  // A list taller than its box keeps the option the keyboard is on in view, as a native select does.
  useEffect(() => {
    if (open) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => event.target instanceof Node && !root.current?.contains(event.target) && setOpen(false);
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
    // The browser's shortcuts use these keys with a modifier (Alt+Home, Cmd+Down): leave them be.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const last = options.length - 1;
    if (event.key === "ArrowDown") setActive(Math.min(active + 1, last));
    else if (event.key === "ArrowUp") setActive(Math.max(active - 1, 0));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || event.key === " ") choose(active);
    else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") {
        // Handled here: an enclosing popup that also listens for Escape stays open.
        event.preventDefault();
        root.current?.querySelector("button")?.focus();
      }
      return;
    } else return;
    event.preventDefault();
  };

  return (
    <div ref={root} className="relative">
      <span id={`${id}-label`} className="block text-caption text-fg-2">{label}</span>
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
        className={`mt-1 flex min-h-11 w-full items-center justify-between gap-2 rounded border border-edge bg-ink px-2 py-2 text-left text-data text-fg hover:border-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0`}
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
          className={`absolute z-50 mt-1 max-h-64 w-full min-w-40 overflow-y-auto rounded border border-line-2 bg-ink-2 p-1 shadow-platform outline-none ${align === "end" ? "right-0" : "left-0"}`}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()} // keeps focus on the list until the click lands
              onClick={() => choose(index)}
              onKeyDown={onKey}
              onMouseEnter={() => setActive(index)}
              className={`flex min-h-11 items-center rounded px-2 py-2 text-data lg:block lg:min-h-0 ${index === active ? "bg-glow/10 text-glow" : "text-fg-2"} ${option.value === value ? "font-medium" : ""}`}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
