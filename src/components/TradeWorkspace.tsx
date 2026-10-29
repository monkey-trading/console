"use client";

/**
 * The trading workspace. From 1024 px it is three columns: watchlist, chart with the account panels,
 * and the order ticket. Below that it shows one pane at a time, chosen from a bar at the foot.
 */

import { useEffect, useRef, useState } from "react";

import { BottomPanel } from "./BottomPanel";
import { ChartPanel } from "./ChartPanel";
import { OrderTicket } from "./OrderTicket";
import { PhoneNav, type PhonePane } from "./PhoneNav";
import { Watchlist } from "./Watchlist";

/** Hides a pane below 1024 px unless it is the one chosen; the desktop layout shows all of them. */
const hiddenUnless = (current: PhonePane, pane: PhonePane) => (current === pane ? "" : "max-lg:hidden");

export function TradeWorkspace() {
  const [pane, setPane] = useState<PhonePane>("chart");
  const focusMarket = useRef(false);
  useEffect(() => {
    // The watchlist the user tapped is hidden now; focus goes to the heading of the market they chose.
    if (focusMarket.current && pane === "chart") document.getElementById("market-title")?.focus();
    focusMarket.current = false;
  }, [pane]);
  const picked = () => {
    if (window.matchMedia("(width >= 64rem)").matches) return;
    focusMarket.current = true;
    setPane("chart");
  };
  return (
    <div className="grid min-h-0 flex-1 max-lg:content-start lg:grid-cols-[210px_minmax(0,1fr)_290px] xl:grid-cols-[230px_minmax(0,1fr)_310px]">
      <div className={`min-h-0 lg:overflow-y-auto ${hiddenUnless(pane, "markets")}`}><Watchlist onPick={picked} /></div>
      <div className="flex min-h-0 min-w-0 flex-col lg:overflow-y-auto">
        <div className={`flex flex-1 flex-col ${hiddenUnless(pane, "chart")}`}><ChartPanel /></div>
        <div className={`flex shrink-0 flex-col ${hiddenUnless(pane, "account")}`}><BottomPanel /></div>
      </div>
      <div className={`min-h-0 border-line lg:overflow-y-auto lg:border-l ${hiddenUnless(pane, "trade")}`}><OrderTicket /></div>
      <PhoneNav pane={pane} onChange={setPane} />
    </div>
  );
}
