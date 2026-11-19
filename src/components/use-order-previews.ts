"use client";

/**
 * The server's previews of exact orders (#916's `GET /v1/accounts/{address}/preview`), asked a moment after the orders last
 * changed, so typing a size asks once, and again at each new account read and every `REFRESH_MS` of the server's clock, so the
 * figures follow prices. Each answer stays until the next answers arrive.
 */

import { useEffect, useState } from "react";

import type { OrderPreviewRequest } from "@/lib/engine/portfolio-types";
import type { AccountModel } from "@/lib/models";
import type { ConsoleStore } from "@/lib/store/store";
import { previewKey, requestOfKey, type PreviewAnswer } from "@/lib/ticket-portfolio";

/** How long the orders must stay unchanged before they are asked about, in milliseconds. */
const SETTLE_MS = 250;
/** How often the answers are asked again while the orders stay the same, in milliseconds of the server's clock. */
const REFRESH_MS = 2_000;

/** Each request's answer by `previewKey`: a preview, `"failed"`, or absent while awaited. Only the latest requests' answers are kept. */
export function useOrderPreviews(store: ConsoleStore, requests: readonly OrderPreviewRequest[], account: AccountModel | null, nowMs: number): ReadonlyMap<string, PreviewAnswer> {
  const [answers, setAnswers] = useState<ReadonlyMap<string, PreviewAnswer>>(() => new Map());
  // The requests by their keys, so a new array naming the same orders asks nothing new.
  const keys = requests.map(previewKey).join("\n");
  const period = Math.floor(nowMs / REFRESH_MS);
  useEffect(() => {
    if (keys === "") return;
    let ignore = false;
    const asked = keys.split("\n");
    const timer = setTimeout(() => {
      const reads = asked.map((key) => store.deps.client.preview(requestOfKey(key)).then((answer): PreviewAnswer => answer, (): PreviewAnswer => "failed"));
      void Promise.all(reads).then((results) => {
        if (!ignore) setAnswers(new Map(asked.map((key, index) => [key, results[index]])));
      });
    }, SETTLE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [store, keys, account, period]);
  return answers;
}
