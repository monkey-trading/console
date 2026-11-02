"use client";

/** The listed markets as a select's options, held steady while the list is unchanged. */

import { useMemo } from "react";

import type { MarketId } from "@/lib/engine/types";
import type { ConsoleState } from "@/lib/store/state";

import { useSelected } from "./use-feed";

const key = (state: ConsoleState): string => state.markets.map((m) => `${m.id}:${m.symbol}`).join(",");

/** The market ids and symbols for a select. */
export function useMarketOptions(): readonly { id: MarketId; label: string }[] {
  const listed = useSelected(key);
  return useMemo(() => (listed === "" ? [] : listed.split(",").map((entry) => ({ id: Number(entry.split(":")[0]), label: entry.split(":")[1] ?? "" }))), [listed]);
}
