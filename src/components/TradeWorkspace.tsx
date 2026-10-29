"use client";

/**
 * The trading workspace. From 1024 px it is three columns: watchlist, chart with the account panels,
 * and the order ticket. Below that it shows one pane at a time, chosen from a bar at the foot.
 */

import { useEffect, useRef, useState } from "react";

import { BottomPanel } from "./BottomPanel";
import { ChartPanel } from "./ChartPanel";
import { OrderTicket } from "./OrderTicket";
import { PHONE_PANE_IDS, PhoneNav, type PhonePane } from "./PhoneNav";
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
  const choose = (next: PhonePane) => {
    // Every pane starts at its top, not at the offset the last one was scrolled to.
    if (next !== pane) window.scrollTo({ top: 0, behavior: "instant" });
    setPane(next);
  };
  useEffect(() => {
    // Narrowing the window hides the panes that are not chosen: keep the one that holds focus.
    const query = window.matchMedia("(width < 64rem)");
    const onChange = () => {
      const held = document.activeElement?.closest("[data-pane]")?.getAttribute("data-pane");
      if (query.matches && PHONE_PANE_IDS.some((id) => id === held)) setPane(held as PhonePane);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const picked = () => {
    if (window.matchMedia("(width >= 64rem)").matches) return;
    focusMarket.current = true;
    setPane("chart");
  };
  return (
    <div className="grid min-h-0 flex-1 max-lg:content-start lg:grid-cols-[210px_minmax(0,1fr)_290px] xl:grid-cols-[230px_minmax(0,1fr)_310px]">
      <div data-pane="markets" className={`min-h-0 lg:overflow-y-auto ${hiddenUnless(pane, "markets")}`}><Watchlist onPick={picked} /></div>
      <div className="flex min-h-0 min-w-0 flex-col lg:overflow-y-auto">
        <div data-pane="chart" className={`flex flex-1 flex-col ${hiddenUnless(pane, "chart")}`}><ChartPanel /></div>
        <div data-pane="account" className={`flex shrink-0 flex-col ${hiddenUnless(pane, "account")}`}><BottomPanel /></div>
      </div>
      <div data-pane="trade" className={`min-h-0 border-line lg:overflow-y-auto lg:border-l ${hiddenUnless(pane, "trade")}`}><OrderTicket /></div>
      <PhoneNav pane={pane} onChange={choose} />
    </div>
  );
}
