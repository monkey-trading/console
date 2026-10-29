/** The mock's price history for each timeframe: what a live build would read from a market-data source. */

import { seedBars, type Bar } from "../bars";
import { MARKETS } from "./markets";

/**
 * History ending at `endPrice` for the market named `symbol`, as bars of `seconds`. The seed
 * depends on the market and the timeframe, so each timeframe has its own plausible history.
 */
export function mockHistory(symbol: string, seconds: number, endMs: number, endPrice: number): Bar[] {
  const listed = MARKETS.find((m) => m.spec.symbol === symbol);
  const vol = listed ? listed.sim.volBps : 1;
  return seedBars(1871 + (listed?.spec.id ?? 0) * 1_000 + seconds, endMs, endPrice, seconds, vol);
}
