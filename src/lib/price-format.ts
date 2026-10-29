/** Price text for display, in no locale; floats here never mirror engine state. */

import { formatFixedPlaces, type Fixed } from "./fixed";
import { groupThousands } from "./format";

/** `67420.5` as `67,420.50` with `places` after the point. */
export function formatPrice(price: number, places: number): string {
  const fixed = Math.abs(price).toFixed(places);
  const [whole = "0", frac] = fixed.split(".");
  return `${price < 0 ? "-" : ""}${groupThousands(Number(whole))}${frac ? `.${frac}` : ""}`;
}

/** A price held as `Fixed`, truncated to `places` and grouped, as the engine's own arithmetic truncates. */
export function formatMark(price: Fixed, places: number): string {
  return formatFixedPlaces(price, places);
}

/** Splits a formatted price into the part to show strongly and the decimals to show muted. */
export function splitDecimals(text: string): [string, string] {
  const dot = text.indexOf(".");
  return dot < 0 ? [text, ""] : [text.slice(0, dot), text.slice(dot)];
}
