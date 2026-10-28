/** The trading workspace: watchlist, chart with the account panels, and the order ticket. */

import { BottomPanel } from "./BottomPanel";
import { ChartPanel } from "./ChartPanel";
import { OrderTicket } from "./OrderTicket";
import { Watchlist } from "./Watchlist";

export function TradeWorkspace() {
  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[210px_minmax(0,1fr)_290px] xl:grid-cols-[230px_minmax(0,1fr)_310px]">
      <div className="min-h-0 lg:overflow-y-auto"><Watchlist /></div>
      <div className="flex min-h-0 min-w-0 flex-col lg:overflow-hidden">
        <ChartPanel />
        <BottomPanel />
      </div>
      <div className="min-h-0 border-t border-line lg:overflow-y-auto lg:border-t-0 lg:border-l"><OrderTicket /></div>
    </div>
  );
}
