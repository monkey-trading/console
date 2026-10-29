"use client";

/** Closes a popup on Escape, including after a pointer click in Safari, which leaves focus on the body. */

import { type RefObject, useEffect, useEffectEvent } from "react";

import { closesOnEscape } from "@/lib/escape";

/** Calls `close` on an Escape that `closesOnEscape` accepts, while `open`; `root` holds the popup and its toggle. */
export function useEscapeClose(open: boolean, root: RefObject<HTMLElement | null>, close: () => void): void {
  const onEscape = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const el = root.current;
      if (!el) return;
      const press = {
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        inside: event.target instanceof Node && el.contains(event.target),
        onBody: event.target === document.body,
        // The funding drawer is a modal dialog; one that holds the popup (the wallet menu in it) does not count.
        modalElsewhere: Array.from(document.querySelectorAll("dialog[open]")).some((dialog) => !dialog.contains(el)),
      };
      if (!closesOnEscape(press)) return;
      event.preventDefault();
      onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, root]);
}
