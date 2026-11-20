"use client";

/**
 * The server's previews of exact orders, asked as `OrderPreviews` schedules them: a moment after the orders last changed, at
 * each new account read and every `REFRESH_MS` of the server's clock, and when the surface or the tab is shown again.
 */

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

import type { AccountModel } from "@/lib/models";
import { NO_ANSWERS, OrderPreviews } from "@/lib/order-previews";
import type { OrderPreviewRequest } from "@/lib/engine/portfolio-types";
import type { ConsoleStore } from "@/lib/store/store";
import { previewKey, type PreviewAnswer } from "@/lib/ticket-portfolio";

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
  const [answers, setAnswers] = useState<ReadonlyMap<string, PreviewAnswer>>(NO_ANSWERS);
  // The requests by their keys, so a new array naming the same orders asks nothing new.
  const keys = requests.map(previewKey).join("\n");
  const period = Math.floor(nowMs / REFRESH_MS);
  const previews = useRef<OrderPreviews | null>(null);
  const onScreen = useEffectEvent(() => document.visibilityState !== "hidden" && (surface === null || isShown(surface.current)));
  useEffect(() => {
    const started = new OrderPreviews({
      read: (request) => store.deps.client.preview(request),
      publish: setAnswers,
      shown: onScreen,
      watch: (changed) => {
        document.addEventListener("visibilitychange", changed);
        const element = surface?.current ?? null;
        const resized = new ResizeObserver(changed);
        if (element !== null) resized.observe(element);
        return () => { document.removeEventListener("visibilitychange", changed); resized.disconnect(); };
      },
    });
    previews.current = started;
    return () => { started.stop(); previews.current = null; };
  }, [store, surface]);
  useEffect(() => previews.current?.setOrders(keys), [keys]);
  // The same orders are asked about again as the account and prices move, never while a read of them is on its way.
  useEffect(() => previews.current?.refresh(), [account, period]);
  return answers;
}
