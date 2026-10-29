"use client";

/**
 * The trading workspace. From 1024 px it is three columns: watchlist, chart with the account panels,
 * and the order ticket. Below that it shows one pane at a time, chosen from a bar at the foot.
 */

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { type FocusWhere, paneWhenNarrowed, rememberPane } from "@/lib/panes";

import { BottomPanel } from "./BottomPanel";
import { ChartPanel } from "./ChartPanel";
import { OrderTicket } from "./OrderTicket";
import { PHONE_PANES, PhoneNav, type PhonePane } from "./PhoneNav";
import { Watchlist } from "./Watchlist";

/** Hides a pane below 1024 px unless it is the one chosen; the desktop layout shows all of them. */
const hiddenUnless = (current: PhonePane, pane: PhonePane) => (current === pane ? "" : "max-lg:hidden");

export function TradeWorkspace() {
  const [pane, setPane] = useState<PhonePane>("chart");
  const focusMarket = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<{ pane: PhonePane | null; element: Element | null }>({ pane: null, element: null });
  useEffect(() => {
    // The browser blurs a focused control the moment narrowing hides its pane, before any listener
    // runs, so the pane is recorded as focus moves and shown when the layout narrows.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const owner = root.current?.contains(target) ? PHONE_PANES.find((p) => target.closest(`[data-pane="${p.id}"]`)) : undefined;
      const where: FocusWhere<PhonePane> = owner ? { kind: "pane", pane: owner.id } : target.closest("dialog") ? { kind: "dialog" } : { kind: "elsewhere" };
      focused.current = { pane: rememberPane(focused.current.pane, where), element: owner ? target : focused.current.element };
    };
    const wide = window.matchMedia("(width >= 64rem)");
    const onChange = () => {
      const { pane: held, element } = focused.current;
      if (wide.matches || !held) return;
      flushSync(() => setPane((chosen) => paneWhenNarrowed(chosen, held)));
      // Only a blurred page gets its place back; focus inside an open dialog stays where it is.
      if ((document.activeElement === document.body || !document.activeElement) && element instanceof HTMLElement && element.isConnected) element.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    wide.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      wide.removeEventListener("change", onChange);
    };
  }, []);
  useEffect(() => {
    // The watchlist the user tapped is hidden now; focus goes to the heading of the market they chose.
    if (focusMarket.current && pane === "chart") document.getElementById("market-title")?.focus();
    focusMarket.current = false;
  }, [pane]);
  const choose = (next: PhonePane) => {
    // Every pane starts at its top, not at the offset the last one was scrolled to.
    if (next !== pane) window.scrollTo({ top: 0, behavior: "instant" });
    // A pane chosen from the bar replaces the place focus held; Safari does not focus the bar's buttons, so focusin cannot say so.
    focused.current = { pane: null, element: null };
    setPane(next);
  };
  const picked = () => {
    if (window.matchMedia("(width >= 64rem)").matches) return;
    focusMarket.current = true;
    focused.current = { pane: null, element: null };
    setPane("chart");
  };
  return (
    <div ref={root} className="grid min-h-0 flex-1 max-lg:content-start lg:grid-cols-[210px_minmax(0,1fr)_290px] xl:grid-cols-[230px_minmax(0,1fr)_310px]">
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
