/** Price text for display, in no locale; floats here never mirror engine state. */

import { groupThousands } from "./format";

/** `67420.5` as `67,420.50` with `places` after the point. */
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
