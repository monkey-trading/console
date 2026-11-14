"use client";

/** Open positions with their profit and loss, hold and close fee, a Close button each and a Close all above them: a table from 1024 px, cards below. */

import { Fragment, useEffect, useId } from "react";

import { CONFIRM_MIN_GAP_MS, CONFIRM_MS } from "@/lib/confirm-window";
import { describeLeftOut, planCloseAll, pressBatch, targetsKey } from "@/lib/close-all";
import { ticketClose } from "@/lib/close-preview";
import { describeNextFall, describeSchedule, formatHold } from "@/lib/fee-words";
import { formatRate } from "@/lib/format";
import { stressTermsAt } from "@/lib/pricing";
import { formatCloseout, formatMark } from "@/lib/price-format";
import { absFixed, formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { roundToPlaces } from "@/lib/fixed-rounding";
import { closingPrice } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import { closeAll } from "@/lib/store/batch-actions";
import { previewTicket, unrealisedPnl, usdConverter } from "@/lib/ticket";
import { currentParams, positionFeeNow } from "@/lib/ticket-figures";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { Notice } from "./Notice";
import { useReadOnlyNote } from "./SignGate";
import { Term } from "./house/Panel";
import { useConfirmWindow } from "./use-confirm-window";
import { usePrefs } from "./use-prefs";

const TH = "px-4 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";
/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** What the Close-out value means, shared by the table's head and the phone rows' label. */
const CLOSEOUT_TIP = "Where this market must reach for your account to fall below its close-out level, with your other positions held at their marks. Margin is shared, and the largest losing position closes first, which may be another. Due: already below it. None: no price in the node's range reaches it.";

/** What the hold, fee and close columns mean, shared by the table's head and the phone rows' labels. */
const HOLD_TIP = "How long the position has been held, from its open time: an add moves the open time to the size-weighted average of now and the open time, counting the units already held as no older than the fee curve's end (15 minutes at launch); a reduction leaves it.";
const CLOSE_TIP = "What closing the whole position now moves your cash by: the realised result at the node's closing price, less the profit fee. Exact while the price, the fee rate and, for a market quoted in another currency, the FX rate hold; a figure after ≥ is the least a close keeps while the price and the FX rate hold and the fee rate falls.";

/** The slippage bound a Close sends, capped at the market's own. */
const CLOSE_SLIPPAGE_BPS = 25;

export function PositionsView() {
  const snapshot = useConsole();
  const { account, markets, busy, signatures, quotes, house, quoted: asked, notices, now } = snapshot;
  // The house state's terms, only while current: a change to the fee may otherwise be unread.
  const terms = currentParams(snapshot);
  const { store } = useSession();
  const id = useId();
  const readOnly = useReadOnlyNote(id, "Close");
  const { armed, state, arm, cancel } = useConfirmWindow(CONFIRM_MS, CONFIRM_MIN_GAP_MS);
  const { confirmBatch } = usePrefs().prefs;
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
    // The rate a close pays now runs on the node's clock; before V55 a close pays the base.
    const fee = positionFeeNow(snapshot, p);
    const feeBps = fee?.feeBps ?? terms?.profitFeeBps ?? null;
    const quoted = signatures === "checked"
      ? (quote === undefined ? null : closingPrice(quote, side, qty))
      : market === undefined ? null : (previewTicket({ market, side, qty, slippageBps: CLOSE_SLIPPAGE_BPS, account, houseNav: house.nav, stress: stressTermsAt(terms?.stressLevels, market.stress), closeFeeBps: feeBps ?? undefined }).quote?.price ?? null);
    // The node's whole-close quote is exact, as is the mock's own price, which its fill uses.
    const closeNow = market === undefined || known === null || !snapshot.pricingCurrent ? null : ticketClose({ position: p, side, qty, price: quoted, exactPrice: true, feeBps, fallsAt: fee?.fallsAt ?? null, now, toUsdDown: usdConverter(market.view, known, "down") });
    const slippageBps = Math.min(CLOSE_SLIPPAGE_BPS, market?.view.max_slippage_bps ?? CLOSE_SLIPPAGE_BPS);
    const close = (event: { currentTarget: HTMLElement }) => {
      if (quoted === null) return;
      keepFocus(event.currentTarget);
      void placeOrder(store, { market: p.market, side, qty, kind: { kind: "market", quoted, slippageBps }, reduceOnly: true }, "positions");
    };
    return {
      key: p.market,
      symbol: String(market?.symbol ?? p.market),
      long: p.qty > 0n,
      size: formatFixedPlaces(absFixed(p.qty), 6),
      entry: formatMark(p.entry, places),
      mark: known === null ? "—" : formatMark(known, places),
      pnl: pnl === null ? "—" : formatUsd(pnl),
      closeout: formatCloseout(p.closeout, places),
      hold: fee === null ? "—" : formatHold(fee.holdMs),
      fee: feeBps === null ? "—" : formatRate(feeBps),
      falls: fee === null ? null : describeNextFall(fee, terms?.profitFeeBps ?? null, now),
      // A bound's figure rounds down, the way "at least" reads.
      proceeds: closeNow === null ? "—" : closeNow.exact ? formatUsd(closeNow.net) : `≥ ${formatUsd(roundToPlaces(closeNow.net, 2, "down"))}`,
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
  // An account that could not be read (the panel above says so) shows no positions, rather than none as if it had none.
  if (account === null && notices.accountRead !== undefined) return <p className="px-4 py-6 text-caption text-fg-3">Your positions show once your account can be read.</p>;
  if (positions.length === 0) return <><p className="px-4 py-6 text-caption text-fg-3">No open positions.</p><div className="px-4 has-[p]:pb-3"><Notice surface="positions" /></div></>;
  const closeEverything = (event: { currentTarget: HTMLElement }) => {
    const press = pressBatch(confirmBatch, state(), count);
    if (press === "arm") arm();
    if (press !== "send") return;
    cancel();
    keepFocus(event.currentTarget);
    void closeAll(store, targets, CLOSE_SLIPPAGE_BPS);
  };
  // A held Enter repeats its click: only a separate press may confirm.
  const holdsDown = (event: { repeat: boolean; preventDefault: () => void }) => { if (event.repeat) event.preventDefault(); };
  const noteId = `${id}-left-out`;
  const feeTip = `The profit fee a close of this position pays on a gain now. ${terms === null ? "It falls as the hold lengthens to the curve's end." : describeSchedule(terms)}`;
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
      <div className="px-4 has-[p]:border-b has-[p]:border-line has-[p]:pb-3"><Notice surface="positions" /></div>
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
              <div><dt className="text-label text-fg-3"><Term label="Close-out" tip={CLOSEOUT_TIP} /></dt><dd>{r.closeout}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Held" tip={HOLD_TIP} /></dt><dd>{r.hold}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Profit fee" tip={feeTip} /></dt><dd>{r.fee}{r.falls !== null && <span className="block text-label text-fg-3">{r.falls}</span>}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Close now" tip={CLOSE_TIP} /></dt><dd>{r.proceeds}</dd></div>
            </dl>
            <button type="button" disabled={!r.closable} className={`${BUTTON} mt-3 w-full`} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
            {r.unquoted && <p className="mt-2 text-label text-fg-3">Select {r.symbol} to get its closing price.</p>}
          </li>
        ))}
      </ul>
      <div className="relative hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[720px] text-caption">
          <thead><tr className="border-b border-line"><th className={TH}>Market</th><th className={TH}>Side</th><th className={TH}>Size</th><th className={TH}>Entry</th><th className={TH}>Mark</th><th className={TH}><Term label="Close-out" tip={CLOSEOUT_TIP} /></th><th className={TH}>P&amp;L</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.key}>
              <tr>
                <td className="px-4 py-4 text-fg">{r.symbol}</td>
                <td className={`px-4 py-4 ${r.long ? "text-glow" : "text-ember"}`}>{r.long ? "Long" : "Short"}</td>
                <td className="px-4 py-4">{r.size}</td>
                <td className="px-4 py-4">{r.entry}</td>
                <td className="px-4 py-4">{r.mark}</td>
                <td className="px-4 py-4">{r.closeout}</td>
                <td className={`px-4 py-4 ${r.loss ? "text-ember" : "text-glow"}`}>{r.pnl}</td>
                <td className="px-4 py-4 text-right">
                  <button type="button" disabled={!r.closable} className={BUTTON} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
                  {r.unquoted && <p className="mt-1 text-label text-fg-3">Select {r.symbol} to get its closing price.</p>}
                </td>
              </tr>
              {/* The hold and the close's fee and proceeds, on a line of their own so the table keeps its width. */}
              <tr className="border-b border-line last:border-b-0">
                <td colSpan={8} className="px-4 pb-4 text-label leading-relaxed text-fg-3">
                  <span className="sr-only">{r.symbol}: </span><Term label="Held" tip={HOLD_TIP} /> <span className="text-fg-2">{r.hold}</span> · <Term label="Profit fee" tip={feeTip} /> <span className="text-fg-2">{r.fee}</span>{r.falls !== null && `, ${r.falls.charAt(0).toLowerCase()}${r.falls.slice(1)}`} · <Term label="Close now" tip={CLOSE_TIP} /> <span className="text-fg-2">{r.proceeds}</span>
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
