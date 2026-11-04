"use client";

/** How the Staking page names a candidate: its hostname from the node's operator list where it can show one, else its short address. */

import { useCallback, useSyncExternalStore } from "react";

import { shortHex } from "@/lib/format";
import type { OperatorReads } from "@/lib/monkey/operators";
import { operatorCells } from "@/lib/staking/operator-cells";

/** The label for each address, following the operator list as it is read again, or the last one verified. */
export function useOperatorLabel(operators: OperatorReads): (address: string) => string {
  const { list, held } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  // The last list verified names candidates while the node is not trusted, as the delegation forms choose from it.
  const rows = list.value?.rows ?? held?.view.rows;
  return useCallback((address: string) => {
    const row = rows?.find((candidate) => candidate.address === address);
    return row === undefined ? shortHex(address) : operatorCells(row).label;
  }, [rows]);
}
