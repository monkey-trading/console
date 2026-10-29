"use client";

/** Open positions with their profit and loss and a Close button: a table from 1024 px, cards below. */

import { formatMark } from "@/lib/price-format";
import { absFixed, formatFixedPlaces, formatUsd, mulFixed } from "@/lib/fixed";
import { closingPrice } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import { previewTicket } from "@/lib/ticket";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** The slippage bound a Close sends, capped at the market's own. */
const CLOSE_SLIPPAGE_BPS = 25;

export function PositionsView() {
  const { account, markets, busy, signatures, quotes, house, quoted: asked } = useConsole();
  const { store } = useSession();
  const positions = account?.positions ?? [];
  if (positions.length === 0) return <p className="px-4 py-6 text-caption text-fg-3">No open positions.</p>;
  const rows = positions.map((p) => {
    const market = markets.find((m) => m.id === p.market);
    // An unpriced market shows no mark and no profit, not the entry price as if it were the mark.
    const known = market?.mark ?? null;
    const mark = known ?? p.entry;
    const pnl = known === null ? null : mulFixed(p.qty, known - p.entry);
    const places = market?.places ?? 2;
    const side = p.qty > 0n ? "sell" : "buy";
    const qty = absFixed(p.qty);
    // A live node quotes the price of closing the whole position; the mock's is the console's own estimate.
    const quote = quotes[p.market];
    const quoted = signatures === "checked"
      ? (quote === undefined ? null : closingPrice(quote, side, qty))
      : market === undefined ? null : (previewTicket({ market, side, notional: absFixed(mulFixed(p.qty, mark)), slippageBps: CLOSE_SLIPPAGE_BPS, account, houseNav: house.nav }).quote?.price ?? null);
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
      closable: !busy && market?.open === true && known !== null && quoted !== null,
      // The node quotes at most four markets at once, the selected one first; a held market left out has no closing price until it is selected.
      unquoted: signatures === "checked" && !asked.includes(p.market) && market?.open === true && known !== null,
      close,
    };
  });
  return (
    <>
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
            <button type="button" disabled={!r.closable} className={`${BUTTON} mt-3 w-full`} aria-label={`Close ${r.symbol} position`} onClick={r.close}>Close</button>
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
                  <button type="button" disabled={!r.closable} className={BUTTON} aria-label={`Close ${r.symbol} position`} onClick={r.close}>Close</button>
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
