"use client";

/**
 * The trading workspace. From 1024 px it is three columns: watchlist, chart with the account panels,
 * and the order ticket. Below that it shows one pane at a time, chosen from a bar at the foot.
 */

import { useEffect, useRef, useState } from "react";

import { BottomPanel } from "./BottomPanel";
import { ChartPanel } from "./ChartPanel";
import { OrderTicket } from "./OrderTicket";
import { PHONE_PANES, PhoneNav, type PhonePane } from "./PhoneNav";
import { Watchlist } from "./Watchlist";

/** Hides a pane below 1024 px unless it is the one chosen; the desktop layout shows all of them. */
const phoneOnly = (current: PhonePane, pane: PhonePane) => (current === pane ? "" : "max-lg:hidden");

export function TradeWorkspace() {
  const [pane, setPane] = useState<PhonePane>(PHONE_PANES[1].id);
  const focusMarket = useRef(false);
  useEffect(() => {
    // The watchlist the user tapped is hidden now; focus goes to the heading of the market they chose.
    if (focusMarket.current && pane === "chart") document.getElementById("market-title")?.focus();
    focusMarket.current = false;
  }, [pane]);
  const picked = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    focusMarket.current = true;
    setPane("chart");
  };
  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[210px_minmax(0,1fr)_290px] xl:grid-cols-[230px_minmax(0,1fr)_310px]">
      <div className={`min-h-0 lg:overflow-y-auto ${phoneOnly(pane, "markets")}`}><Watchlist onPick={picked} /></div>
      <div className="flex min-h-0 min-w-0 flex-col lg:overflow-y-auto">
        <div className={`flex flex-1 flex-col ${phoneOnly(pane, "chart")}`}><ChartPanel /></div>
        <div className={`flex shrink-0 flex-col ${phoneOnly(pane, "account")}`}><BottomPanel /></div>
      </div>
      <div className={`min-h-0 border-line lg:overflow-y-auto lg:border-l ${phoneOnly(pane, "trade")}`}><OrderTicket /></div>
      <PhoneNav pane={pane} onChange={setPane} />
    </div>
  );
}
