/**
 * The trading preferences a trader keeps in this browser (monkey-trading/console#169), and the
 * last size they placed in each market. What a browser already holds is untrusted input: every
 * field is read on its own and falls back to its default when it is missing or not one the console
 * offers, so a stale or hand-edited value never breaks the page.
 */

import { parseSize, SLIPPAGE_CHOICES } from "./ticket";

export const ORDER_TYPES = ["market", "limit", "stop"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** The names the ticket and Settings give each order type. */
export const ORDER_LABELS: Record<OrderType, string> = { market: "Market", limit: "Limit", stop: "Stop" };

/** Where a new ticket's size starts: the market's minimum order value, or the size last placed in that market. */
export type SizePreference = "minimum" | "last";

export interface Prefs {
  /** The ticket's order type before the trader picks one. */
  orderType: OrderType;
  /** The ticket's slippage bound in basis points, one of `SLIPPAGE_CHOICES`; each market clamps it to its own maximum. */
  slippageBps: number;
  size: SizePreference;
  /** Whether Cancel all and Close all ask for a second press. */
  confirmBatch: boolean;
  /** Whether the chart draws the position's entry and the resting orders. */
  chartLines: boolean;
}

export const DEFAULT_PREFS: Prefs = { orderType: "market", slippageBps: 10, size: "minimum", confirmBatch: true, chartLines: true };

/** The localStorage keys, one for the preferences and one for the last sizes. */
export const PREFS_KEY = "monkeytrading.preferences";
export const SIZES_KEY = "monkeytrading.last-sizes";

/** The most markets whose last size is kept, so a store a script filled stays small. */
const MAX_SIZES = 200;

const record = (raw: string | null): Record<string, unknown> | null => {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // An array or a primitive is not a record this console wrote.
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** The preferences in `raw`, with the default for every field that is missing or not offered. */
export function parsePrefs(raw: string | null): Prefs {
  const stored = record(raw);
  if (stored === null) return DEFAULT_PREFS;
  const { orderType, slippageBps, size, confirmBatch, chartLines } = stored;
  return {
    orderType: ORDER_TYPES.find((t) => t === orderType) ?? DEFAULT_PREFS.orderType,
    slippageBps: SLIPPAGE_CHOICES.find((bps) => bps === slippageBps) ?? DEFAULT_PREFS.slippageBps,
    size: size === "last" || size === "minimum" ? size : DEFAULT_PREFS.size,
    confirmBatch: typeof confirmBatch === "boolean" ? confirmBatch : DEFAULT_PREFS.confirmBatch,
    chartLines: typeof chartLines === "boolean" ? chartLines : DEFAULT_PREFS.chartLines,
  };
}

/** The last size per market id in `raw`; a value that is not a size the ticket accepts is dropped. */
export function parseSizes(raw: string | null): Readonly<Record<number, string>> {
  const stored = record(raw);
  const out: Record<number, string> = {};
  if (stored === null) return out;
  for (const [id, size] of Object.entries(stored).slice(0, MAX_SIZES)) {
    const market = Number(id);
    if (Number.isSafeInteger(market) && market > 0 && typeof size === "string" && parseSize(size).kind === "qty") out[market] = size;
  }
  return out;
}
