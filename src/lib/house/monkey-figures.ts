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
      label: "Earned so far",
      tip: "This is all the MONKEY traders have earned so far. MONKEY is created only when it's claimed, so this isn't the token's supply.",
      value: text(monkey?.emissions?.allocated, formatMonkey),
    },
    {
      label: "Staked",
      tip: "This is the MONKEY locked in staking.",
      value: text(monkey?.staking?.total_staked, formatMonkey),
    },
    {
      label: "USDC distributed",
      tip: "This is all the USDC distributed so far. Stakers share it, and while rotation is on, a fifth of each distribution goes to the operator.",
      value: text(monkey?.distribution?.distributed_usdc_units, formatUsdc),
    },
  ];
}
