/** The one window control the Dashboard page offers, and the window each chart family reads for it (monkey-trading/console#310). */

import type { RangeId } from "./house-series";
import type { TimeframeId } from "./monkey/timeframes";

/** The windows the Dashboard's range control offers, in the order it shows them. */
export const DASHBOARD_RANGES = [
  { id: "1d", label: "1D" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
] as const;

export type DashboardRangeId = (typeof DASHBOARD_RANGES)[number]["id"];

/** The window every chart opens on. */
export const DEFAULT_DASHBOARD_RANGE: DashboardRangeId = "7d";

/** The House chart range each window sets; the ids match the Dashboard's. */
export const HOUSE_RANGE = { "1d": "1d", "7d": "7d", "30d": "30d", "1y": "1y", all: "all" } as const satisfies Readonly<Record<DashboardRangeId, RangeId>>;

/** The MONKEY chart timeframe each window sets. */
export const MONKEY_TIMEFRAME = { "1d": "1d", "7d": "7d", "30d": "30d", "1y": "1y", all: "all" } as const satisfies Readonly<Record<DashboardRangeId, TimeframeId>>;
