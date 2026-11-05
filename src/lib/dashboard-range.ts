/** The one window control the Dashboard page offers; every window is both chart families' own id, so the page passes its choice straight through (monkey-trading/console#310). */

import type { RangeId } from "./house-series";
import type { TimeframeId } from "./monkey/timeframes";

/** The windows the Dashboard's range control offers, in the order it shows them; each id is a House range and a MONKEY timeframe. */
export const DASHBOARD_RANGES = [
  { id: "1d", label: "1D" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
] as const satisfies readonly { id: RangeId & TimeframeId; label: string }[];

export type DashboardRangeId = (typeof DASHBOARD_RANGES)[number]["id"];

/** The window every chart opens on. */
export const DEFAULT_DASHBOARD_RANGE: DashboardRangeId = "7d";
