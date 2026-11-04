/** The House page's MONKEY card: the rows it shows, what each reads, and the words it carries. */

import { formatUsdc, parseUnits } from "@/lib/chart-format";
import type { MonkeyView } from "@/lib/engine/stats-types";
import { formatMonkey } from "@/lib/format";

export type MonkeyFigureRow = {
  label: string;
  tip: string;
  value: string;
};

/** One row per figure, in the order the card shows them. `null` fields read as the em dash. */
export function monkeyFigureRows(monkey: MonkeyView | null): MonkeyFigureRow[] {
  const text = (value: string | undefined, format: (units: bigint) => string): string => {
    const units = value === undefined ? null : parseUnits(value);
    return units === null ? "—" : format(units);
  };
  return [
    {
      label: "Emitted",
      tip: "MONKEY emitted so far: every client's cumulative entitlement. It is minted only when claimed, so this is not the token's supply.",
      value: text(monkey?.emissions?.allocated, formatMonkey),
    },
    {
      label: "Staked",
      tip: "MONKEY locked in the staking contract.",
      value: text(monkey?.staking?.total_staked, formatMonkey),
    },
    {
      label: "USDC distributed",
      tip: "USDC distributed in total across every epoch close: to stakers, and while operator rotation is on, a fifth of each close to the operator in effect.",
      value: text(monkey?.distribution?.distributed_usdc_units, formatUsdc),
    },
  ];
}
