"use client";

/** Open positions with their profit and loss, a Close button each and a Close all above them: a table from 1024 px, cards below. */

import { useEffect, useId } from "react";

import { describeLeftOut, planCloseAll, pressCloseAll, targetsKey } from "@/lib/close-all";
import { formatMark } from "@/lib/price-format";
import { absFixed, formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { closingPrice } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import { closeAll } from "@/lib/store/batch-actions";
import { previewTicket, unrealisedPnl } from "@/lib/ticket";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { useReadOnlyNote } from "./SignGate";
import { useConfirmWindow } from "./use-confirm-window";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";
/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** The slippage bound a Close sends, capped at the market's own. */
const CLOSE_SLIPPAGE_BPS = 25;

/** How long Close all waits for its second press, and how soon after the first a press is taken as the same click's double. */
const CONFIRM_MS = 5_000;
const CONFIRM_MIN_GAP_MS = 400;

export function PositionsView() {
  const { account, markets, busy, signatures, quotes, house, quoted: asked } = useConsole();
  const { store } = useSession();
  const id = useId();
  const readOnly = useReadOnlyNote(id, "Close");
  const { armed, state, arm, cancel } = useConfirmWindow(CONFIRM_MS, CONFIRM_MIN_GAP_MS);
  const positions = account?.positions ?? [];
  const rows = positions.map((p) => {
    const market = markets.find((m) => m.id === p.market);
    // An unpriced market shows no mark and no profit, not the entry price as if it were the mark.
    const known = market?.mark ?? null;
    const pnl = known === null || market === undefined ? null : unrealisedPnl(market.view, p.qty, p.entry, known);
    const places = market?.places ?? 2;
    const side = p.qty > 0n ? "sell" : "buy";
    const qty = absFixed(p.qty);
    // A live node quotes the price of closing the whole position; the mock's is the console's own estimate.
    const quote = quotes[p.market];
    const quoted = signatures === "checked"
      ? (quote === undefined ? null : closingPrice(quote, side, qty))
      : market === undefined ? null : (previewTicket({ market, side, qty, slippageBps: CLOSE_SLIPPAGE_BPS, account, houseNav: house.nav }).quote?.price ?? null);
    const slippageBps = Math.min(CLOSE_SLIPPAGE_BPS, market?.view.max_slippage_bps ?? CLOSE_SLIPPAGE_BPS);
    const close = (event: { currentTarget: HTMLElement }) => {
      if (quoted === null) return;
      keepFocus(event.currentTarget);
      void placeOrder(store, { market: p.market, side, qty, kind: { kind: "market", quoted, slippageBps }, reduceOnly: true });
    };
    return {
      key: p.market,
      symbol: String(market?.symbol ?? p.market),
      long: p.qty > 0n,
      size: formatFixedPlaces(absFixed(p.qty), 6),
      entry: formatMark(p.entry, places),
      mark: known === null ? "—" : formatMark(known, places),
      pnl: pnl === null ? "—" : formatUsd(pnl),
      loss: pnl !== null && pnl < 0n,
      open: market?.open === true,
      // An unpriced market has no closing price, whatever a quote says.
      quoted: known === null ? null : quoted,
      closable: !busy && !readOnly.readOnly && market?.open === true && known !== null && quoted !== null,
      // The node quotes at most four markets at once, the selected one first; a held market left out has no closing price until it is selected.
      unquoted: signatures === "checked" && !asked.includes(p.market) && market?.open === true && known !== null,
      close,
    };
  });
  // Close all sends what each Close button would: its market and its quote, under the same bound.
  const { targets, leftOut } = planCloseAll(rows.map((r) => ({ market: r.key, symbol: r.symbol, open: r.open, quoted: r.quoted })));
  const count = targets.length;
  const leftOutNote = describeLeftOut(leftOut);
  const confirming = armed && count > 0;
  // The window confirms the list it was armed for: when the markets Close all would send change, it closes and the next press arms again.
  const listed = targetsKey(targets);
  useEffect(() => cancel(), [listed, cancel]);
  if (positions.length === 0) return <p className="px-4 py-6 text-caption text-fg-3">No open positions.</p>;
  const closeEverything = (event: { currentTarget: HTMLElement }) => {
    const press = pressCloseAll(state(), count);
    if (press === "arm") arm();
    if (press !== "send") return;
    cancel();
    keepFocus(event.currentTarget);
    void closeAll(store, targets, CLOSE_SLIPPAGE_BPS);
  };
  // A held Enter repeats its click: only a separate press may confirm.
  const holdsDown = (event: { repeat: boolean; preventDefault: () => void }) => { if (event.repeat) event.preventDefault(); };
  const noteId = `${id}-left-out`;
  const describedBy = readOnly.describedBy ?? (leftOutNote === null ? undefined : noteId);
  return (
    <>
      {readOnly.note}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 lg:py-2">
        <button type="button" disabled={busy || readOnly.readOnly || count === 0} className={`${confirming ? ARMED : BUTTON} w-full lg:w-auto`} aria-describedby={describedBy} onClick={closeEverything} onKeyDown={holdsDown}>
          {confirming ? `Confirm: close ${count} ${count === 1 ? "position" : "positions"}` : `Close all (${count})`}
        </button>
        <p role="status" className="sr-only">{confirming ? `Press again within five seconds to close ${count} ${count === 1 ? "position" : "positions"}.` : ""}</p>
        {leftOutNote !== null && <p id={noteId} className="text-label leading-relaxed text-fg-3">{leftOutNote}</p>}
      </div>
      <ul className="lg:hidden">
        {rows.map((r) => (
          <li key={r.key} className="border-b border-line px-4 py-3 text-caption last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <p><span className="text-fg">{r.symbol}</span> <span className={r.long ? "text-glow" : "text-ember"}>{r.long ? "Long" : "Short"}</span></p>
              <p className={r.loss ? "text-ember" : "text-glow"}><span className="sr-only">Profit and loss </span>{r.pnl}</p>
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-fg-2">
              <div><dt className="text-label text-fg-3">Size</dt><dd>{r.size}</dd></div>
              <div><dt className="text-label text-fg-3">Entry</dt><dd>{r.entry}</dd></div>
              <div><dt className="text-label text-fg-3">Mark</dt><dd>{r.mark}</dd></div>
            </dl>
            <button type="button" disabled={!r.closable} className={`${BUTTON} mt-3 w-full`} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
            {r.unquoted && <p className="mt-2 text-label text-fg-3">Select {r.symbol} to get its closing price.</p>}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[640px] text-caption">
          <thead><tr className="border-b border-line"><th className={TH}>Market</th><th className={TH}>Side</th><th className={TH}>Size</th><th className={TH}>Entry</th><th className={TH}>Mark</th><th className={TH}>P&amp;L</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-b-0">
                <td className="px-4 py-4 text-fg">{r.symbol}</td>
                <td className={`px-4 py-4 ${r.long ? "text-glow" : "text-ember"}`}>{r.long ? "Long" : "Short"}</td>
                <td className="px-4 py-4">{r.size}</td>
                <td className="px-4 py-4">{r.entry}</td>
                <td className="px-4 py-4">{r.mark}</td>
                <td className={`px-4 py-4 ${r.loss ? "text-ember" : "text-glow"}`}>{r.pnl}</td>
                <td className="px-4 py-4 text-right">
                  <button type="button" disabled={!r.closable} className={BUTTON} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
                  {r.unquoted && <p className="mt-1 text-label text-fg-3">Select {r.symbol} to get its closing price.</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
