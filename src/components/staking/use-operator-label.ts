"use client";

/** How the Staking page names a candidate: its hostname from the node's operator list where it can show one, else its short address. */

import { useCallback, useSyncExternalStore } from "react";

import { shortHex } from "@/lib/format";
import type { OperatorReads } from "@/lib/monkey/operators";
import { operatorCells } from "@/lib/staking/operator-cells";

export function useOperatorLabel(operators: OperatorReads): (address: string) => string {
  const { list } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const rows = list.value?.rows;
  return useCallback((address: string) => {
    const row = rows?.find((candidate) => candidate.address === address);
    return row === undefined ? shortHex(address) : operatorCells(row).label;
  }, [rows]);
}
