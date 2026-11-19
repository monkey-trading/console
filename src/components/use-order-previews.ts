"use client";

/**
 * The server's previews of exact orders (#916's `GET /v1/accounts/{address}/preview`), asked a moment after the orders last
 * changed, so typing a size asks once, and again at each new account read and every `REFRESH_MS` of the server's clock while
 * the page and the surface reading them are shown and no read is on its way, so the figures follow prices. An answer is kept
 * while its orders are still the ones asked about, whatever reads land meanwhile, and stays until the next answers arrive.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { OrderPreviewRequest } from "@/lib/engine/portfolio-types";
import type { AccountModel } from "@/lib/models";
import type { ConsoleStore } from "@/lib/store/store";
import { previewKey, requestOfKey, type PreviewAnswer } from "@/lib/ticket-portfolio";

/** How long the orders must stay unchanged before they are asked about, in milliseconds. */
const SETTLE_MS = 250;
/** How often the answers are asked again while the orders stay the same, in milliseconds of the server's clock. */
const REFRESH_MS = 2_000;

/**
 * Each request's answer by `previewKey`: a preview, `"failed"`, or absent while awaited. Only the latest requests' answers are
 * kept. `shown` says whether the surface that reads them is on screen; a hidden one is not asked about again until it is.
 */
export function useOrderPreviews(store: ConsoleStore, requests: readonly OrderPreviewRequest[], account: AccountModel | null, nowMs: number, shown: () => boolean = () => true): ReadonlyMap<string, PreviewAnswer> {
  const [answers, setAnswers] = useState<ReadonlyMap<string, PreviewAnswer>>(() => new Map());
  // The requests by their keys, so a new array naming the same orders asks nothing new.
  const keys = requests.map(previewKey).join("\n");
  const period = Math.floor(nowMs / REFRESH_MS);
  // The orders asked about now, whether the hook is mounted, and which orders a read on its way asks about.
  const current = useRef<{ keys: string; mounted: boolean; asking: string | null }>({ keys: "", mounted: false, asking: null });
  const ask = useEffectEvent(() => {
    const asked = current.current.keys;
    if (asked === "" || current.current.asking === asked || !shown() || document.visibilityState === "hidden") return;
    current.current.asking = asked;
    const reads = asked.split("\n").map((key) => store.deps.client.preview(requestOfKey(key)).then((answer): PreviewAnswer => answer, (): PreviewAnswer => "failed"));
    void Promise.all(reads).then((results) => {
      if (current.current.asking === asked) current.current.asking = null;
      // An answer for orders no longer asked about, or after unmount, is dropped.
      if (current.current.mounted && current.current.keys === asked) setAnswers(new Map(asked.split("\n").map((key, index) => [key, results[index]])));
    });
  });
  useEffect(() => {
    const held = current.current;
    held.mounted = true;
    return () => { held.mounted = false; };
  }, []);
  // New orders are asked about once they have settled.
  useEffect(() => {
    current.current.keys = keys;
    if (keys === "") return;
    const timer = setTimeout(ask, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [keys]);
  // The same orders are asked about again as the account and prices move, never while a read of them is on its way.
  useEffect(() => { ask(); }, [account, period]);
  return answers;
}
