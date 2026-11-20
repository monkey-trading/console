"use client";

/**
 * The server's previews of exact orders (#916's `GET /v1/accounts/{address}/preview`), asked a moment after the orders last
 * changed, so typing a size asks once, and again at each new account read and every `REFRESH_MS` of the server's clock while
 * the page and the surface reading them are shown and no read is on its way, so the figures follow prices. An answer is kept
 * while its orders are still the ones asked about, whatever reads land meanwhile, and stays until the next answers arrive.
 */

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

import { onBecomingShown } from "@/lib/became-shown";
import type { OrderPreviewRequest } from "@/lib/engine/portfolio-types";
import type { AccountModel } from "@/lib/models";
import type { ConsoleStore } from "@/lib/store/store";
import { previewKey, requestOfKey, type PreviewAnswer } from "@/lib/ticket-portfolio";

/** How long the orders must stay unchanged before they are asked about, in milliseconds. */
const SETTLE_MS = 250;
/** No answers. */
const NONE: ReadonlyMap<string, PreviewAnswer> = new Map();
/** How often the answers are asked again while the orders stay the same, in milliseconds of the server's clock. */
const REFRESH_MS = 2_000;

/** Whether `element` is rendered: `checkVisibility` where the browser has it, else whether it has a box. */
function isShown(element: HTMLElement | null): boolean {
  if (element === null) return false;
  return typeof element.checkVisibility === "function" ? element.checkVisibility() : element.getClientRects().length > 0;
}

/**
 * Each request's answer by `previewKey`: a preview, `"failed"`, or absent while awaited. Only the latest requests' answers are
 * kept. `surface` is the element that reads them: it is not asked about while off screen, as in a phone layout's other panes,
 * and is asked about when shown; none means always shown.
 */
export function useOrderPreviews(store: ConsoleStore, requests: readonly OrderPreviewRequest[], account: AccountModel | null, nowMs: number, surface: RefObject<HTMLElement | null> | null = null): ReadonlyMap<string, PreviewAnswer> {
  const [answers, setAnswers] = useState<ReadonlyMap<string, PreviewAnswer>>(NONE);
  // The requests by their keys, so a new array naming the same orders asks nothing new.
  const keys = requests.map(previewKey).join("\n");
  const period = Math.floor(nowMs / REFRESH_MS);
  // The orders asked about now, whether the hook is mounted, the latest read's number, and the orders it asks about while it is on its way.
  const current = useRef<{ keys: string; mounted: boolean; latest: number; pending: string | null }>({ keys: "", mounted: false, latest: 0, pending: null });
  const onScreen = useEffectEvent(() => document.visibilityState !== "hidden" && (surface === null || isShown(surface.current)));
  const ask = useEffectEvent(() => {
    const asked = current.current.keys;
    if (asked === "" || current.current.pending === asked || !onScreen()) return;
    current.current.latest += 1;
    const read = current.current.latest;
    current.current.pending = asked;
    const reads = asked.split("\n").map((key) => store.deps.client.preview(requestOfKey(key)).then((answer): PreviewAnswer => answer, (): PreviewAnswer => "failed"));
    void Promise.all(reads).then((results) => {
      // Only the latest read's answers count: an earlier one landing later, one for orders no longer asked about, or one after unmount is dropped.
      if (read !== current.current.latest) return;
      current.current.pending = null;
      if (current.current.mounted && current.current.keys === asked) setAnswers(new Map(asked.split("\n").map((key, index) => [key, results[index]])));
    });
  });
  useEffect(() => {
    const held = current.current;
    held.mounted = true;
    return () => { held.mounted = false; };
  }, []);
  // New orders are asked about once they have settled; with none, the answers held are forgotten, so none is read as current later.
  useEffect(() => {
    current.current.keys = keys;
    const timer = setTimeout(() => (keys === "" ? setAnswers(NONE) : ask()), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [keys]);
  // A surface or tab that is shown again is asked about at once: nothing else changes when a hidden pane is opened.
  useEffect(() => onBecomingShown(onScreen, (check) => {
    document.addEventListener("visibilitychange", check);
    const element = surface?.current ?? null;
    const resized = new ResizeObserver(check);
    if (element !== null) resized.observe(element);
    return () => { document.removeEventListener("visibilitychange", check); resized.disconnect(); };
  }, ask), [keys, surface]);
  // The same orders are asked about again as the account and prices move, never while a read of them is on its way.
  useEffect(() => { ask(); }, [account, period]);
  return answers;
}
