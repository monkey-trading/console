/** Price text for display, in no locale; floats here never mirror engine state. */

import { formatFixedPlaces, type Fixed } from "./fixed";
import type { CloseoutModel } from "./models";
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

/** A position's close-out as the Positions rows show it: its price, Due once the account is below the level, None when no price in the node's range reaches it, a dash when the node does not say. */
export function formatCloseout(closeout: CloseoutModel | null, places: number): string {
  if (closeout === null) return "—";
  if (closeout.reach === "due") return "Due";
  if (closeout.reach === "beyond") return "None";
  return formatMark(closeout.price, places);
}
