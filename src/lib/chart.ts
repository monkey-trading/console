/** Chart geometry and price text, for drawing only; floats here never mirror engine state. */

import { groupThousands } from "./format";
import type { Candle } from "./candles";

export const PLOT = { left: 8, right: 550, top: 12, bottom: 183 } as const;

export interface Scale {
  min: number;
  max: number;
  y(price: number): number;
}

/** A vertical scale that fits every candle, with a margin so wicks do not touch the frame. */
export function scaleFor(candles: readonly Candle[], extra: readonly number[] = []): Scale {
  const prices = [...candles.flatMap((c) => [c.high, c.low]), ...extra];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.08, hi * 0.0002);
  const min = lo - pad;
  const max = hi + pad;
  const height = PLOT.bottom - PLOT.top;
  return { min, max, y: (price) => PLOT.top + ((max - price) / (max - min)) * height };
}

/** `67420.5` as `67,420.50` with `places` after the point, without the visitor's locale. */
export function formatPrice(price: number, places: number): string {
  const fixed = Math.abs(price).toFixed(places);
  const [whole = "0", frac] = fixed.split(".");
  return `${price < 0 ? "-" : ""}${groupThousands(Number(whole))}${frac ? `.${frac}` : ""}`;
}

/** Splits a formatted price into the part to show strongly and the decimals to show muted. */
export function splitDecimals(text: string): [string, string] {
  const dot = text.indexOf(".");
  return dot < 0 ? [text, ""] : [text.slice(0, dot), text.slice(dot)];
}
