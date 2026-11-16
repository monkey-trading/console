"use client";

/** Open positions with their profit and loss at the closing price, hold, profit fee and what a close keeps, a Close button each and a Close all above them: a table of one row each from 1024 px, cards below. */

import { useEffect, useId } from "react";

import { CONFIRM_MIN_GAP_MS, CONFIRM_MS } from "@/lib/confirm-window";
import { describeLeftOut, planCloseAll, pressBatch, targetsKey } from "@/lib/close-all";
import { describeNextFall, describeSchedule, formatHold } from "@/lib/fee-words";
import { formatRate } from "@/lib/format";
import { describePnl } from "@/lib/pnl-words";
import { stressTermsAt } from "@/lib/pricing";
import { formatCloseout, formatMark } from "@/lib/price-format";
import { absFixed, formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { roundToPlaces } from "@/lib/fixed-rounding";
import { closingPrice } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import { closeAll } from "@/lib/store/batch-actions";
import { previewTicket, unrealisedPnl } from "@/lib/ticket";
import { accountFeeTerms, currentParams, positionClose, positionFeeNow } from "@/lib/ticket-figures";
import { accountPricing } from "@/lib/tier-view";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { Notice } from "./Notice";
import { useReadOnlyNote } from "./SignGate";
import { Term } from "./house/Panel";
import { useConfirmWindow } from "./use-confirm-window";
import { usePrefs } from "./use-prefs";

const TH = "whitespace-nowrap px-2 py-3 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
/** A body cell: one line, so a row's height never depends on its figures. */
const TD = "whitespace-nowrap px-2 py-4";
/** A figure column's least width, so a withheld figure ("—") and a shown one take the same room. */
const FIG = "min-w-[10ch]";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";
/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** What the Close-out value means, shared by the table's head and the phone rows' label. */
const CLOSEOUT_TIP = "Where this market must reach for your account to fall below its close-out level, with your other positions held at their marks. Margin is shared, and the largest losing position closes first, which may be another. Due: already below it. None: no price in the node's range reaches it.";

/** What the P&L column means, shared by the table's head and the phone rows' labels. */
const PNL_TIP = "What closing the whole position now realises, before the profit fee: at the node's closing price for the position's size (the bid for a long, the offer for a short), not at the mark, so it already counts the exit spread. Hover the figure for the gain at the mark.";

/** What the hold, fee and close columns mean, shared by the table's head and the phone rows' labels. */
const HOLD_TIP = "How long the position has been held, from its open time: an add moves the open time to the size-weighted average of now and the open time, counting the units already held as no older than the fee curve's end (15 minutes at launch); a reduction leaves it.";
const FEE_USD_TIP = "The profit fee closing the whole position now pays, in USD: the fee rate on a realised gain, and nothing on a close that realises a loss or nothing.";
const CLOSE_TIP = "What closing the whole position now moves your cash by: the realised result at the node's closing price, less the profit fee. Exact while the price, the fee rate and, for a market quoted in another currency, the FX rate hold; a figure after ≥ is the least a close keeps while the price and the FX rate hold and the fee rate falls.";

/** The slippage bound a Close sends, capped at the market's own. */
const CLOSE_SLIPPAGE_BPS = 25;

export function PositionsView() {
  const snapshot = useConsole();
  const { account, markets, busy, signatures, quotes, house, quoted: asked, notices, now } = snapshot;
  // The house state's terms, only while current: a change to the fee may otherwise be unread.
  const terms = currentParams(snapshot);
  // What a close pays: the base less the account's tier's fee discount (V68), under the same curve.
  const feeTerms = accountFeeTerms(snapshot);
  const { store } = useSession();
  const id = useId();
  const readOnly = useReadOnlyNote(id, "Close");
  const { armed, state, arm, cancel } = useConfirmWindow(CONFIRM_MS, CONFIRM_MIN_GAP_MS);
  const { confirmBatch } = usePrefs().prefs;
  const positions = account?.positions ?? [];
  const feeTip = `The profit fee rate a close of this position pays on a gain now. ${feeTerms === null ? "It falls as the hold lengthens to the curve's end." : describeSchedule(feeTerms)}`;
  const rows = positions.map((p) => {
    const market = markets.find((m) => m.id === p.market);
    // An unpriced market shows no mark and no profit, not the entry price as if it were the mark.
    const known = market?.mark ?? null;
    const atMark = known === null || market === undefined ? null : unrealisedPnl(market.view, p.qty, p.entry, known);
    const places = market?.places ?? 2;
    const side = p.qty > 0n ? "sell" : "buy";
    const qty = absFixed(p.qty);
    // A live node quotes the price of closing the whole position; the mock's is the console's own estimate.
    const quote = quotes[p.market];
    // The rate a close pays now runs on the node's clock; before V55 a close pays the base.
    const fee = positionFeeNow(snapshot, p);
    const feeBps = fee?.feeBps ?? feeTerms?.profitFeeBps ?? null;
    const quoted = signatures === "checked"
      ? (quote === undefined ? null : closingPrice(quote, side, qty))
      : market === undefined ? null : (previewTicket({ market, side, qty, slippageBps: CLOSE_SLIPPAGE_BPS, account, houseNav: house.nav, stress: stressTermsAt(terms?.stressLevels, market.stress), closeFeeBps: feeBps ?? undefined, ...accountPricing(account, terms, market.view) }).quote?.price ?? null);
    // The node's whole-close quote is exact, as is the mock's own price, which its fill uses.
    const { close: closeNow, why: withheld } = positionClose(snapshot, market, p, quoted);
    // The P&L is what the close realises at its price; a close that has none shows none, and the figure at the mark stays in its explanation.
    const pnl = closeNow === null ? null : closeNow.realised;
    const noFee = closeNow !== null && closeNow.fee === 0n && closeNow.realised <= 0n;
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
      pnlTip: describePnl(atMark === null ? null : formatUsd(atMark), pnl === null ? (withheld ?? (market?.open === true ? "No closing price has reached the console yet." : "The market is closed, so it has no closing price.")) : null),
      feeUsd: closeNow === null ? "—" : closeNow.exact || closeNow.fee === 0n ? formatUsd(closeNow.fee) : `≤ ${formatUsd(closeNow.fee)}`,
      noFee,
      closeout: formatCloseout(p.closeout, places),
      hold: fee === null ? "—" : formatHold(fee.holdMs),
      fee: feeBps === null ? "—" : formatRate(feeBps),
      falls: fee === null ? null : describeNextFall(fee, feeTerms?.profitFeeBps ?? null, now),
      // The rate's explanation names when it next falls, so the row keeps one line.
      feeTip: fee === null ? feeTip : `${describeNextFall(fee, feeTerms?.profitFeeBps ?? null, now)}. ${feeTip}`,
      // A bound's figure rounds down, the way "at least" reads.
      withheld,
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
  // A reason a figure is withheld is the node's or the house state's, the same for every row it covers: said once, above the table.
  const reasons = [...new Set(rows.flatMap((r) => (r.withheld === null ? [] : [r.withheld])))];
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
              <p className={r.loss ? "text-ember" : "text-glow"}><span className="sr-only">Profit and loss </span><Term label={r.pnl} tip={r.pnlTip} /></p>
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-fg-2">
              <div><dt className="text-label text-fg-3">Size</dt><dd>{r.size}</dd></div>
              <div><dt className="text-label text-fg-3">Entry</dt><dd>{r.entry}</dd></div>
              <div><dt className="text-label text-fg-3">Mark</dt><dd>{r.mark}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Close-out" tip={CLOSEOUT_TIP} /></dt><dd>{r.closeout}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Held" tip={HOLD_TIP} /></dt><dd>{r.hold}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Profit fee" tip={feeTip} /></dt><dd>{r.fee}{r.falls !== null && <span className="block text-label text-fg-3">{r.falls}</span>}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Fee (USD)" tip={FEE_USD_TIP} /></dt><dd>{r.feeUsd}{r.noFee && <span className="block text-label text-fg-3">No profit fee on this close</span>}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Close now" tip={CLOSE_TIP} /></dt><dd>{r.proceeds}{r.withheld !== null && <span className="block text-label text-fg-3">{r.withheld}</span>}</dd></div>
            </dl>
            <button type="button" disabled={!r.closable} className={`${BUTTON} mt-3 w-full`} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
            {r.unquoted && <p className="mt-2 text-label text-fg-3">Select {r.symbol} to get its closing price.</p>}
          </li>
        ))}
      </ul>
      {reasons.map((why) => <p key={why} className="hidden border-b border-line px-4 py-2 text-label text-fg-3 lg:block">{why}</p>)}
      <div role="region" aria-label="Open positions" tabIndex={0} className="relative hidden overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:block">
        <table className="w-full min-w-max text-caption">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Market</th><th className={TH}>Side</th><th className={TH}>Size</th><th className={TH}>Entry</th><th className={TH}>Mark</th>
              <th className={TH}><Term label="Close-out" tip={CLOSEOUT_TIP} /></th><th className={TH}><Term label="P&L" tip={PNL_TIP} /></th><th className={TH}><Term label="Held" tip={HOLD_TIP} /></th>
              <th className={TH}><Term label="Profit fee" tip={feeTip} /></th><th className={TH}><Term label="Fee (USD)" tip={FEE_USD_TIP} /></th><th className={TH}><Term label="Close now" tip={CLOSE_TIP} /></th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-b-0">
                <td className={`${TD} text-fg`}>{r.symbol}</td>
                <td className={`${TD} ${r.long ? "text-glow" : "text-ember"}`}>{r.long ? "Long" : "Short"}</td>
                <td className={TD}>{r.size}</td>
                <td className={TD}>{r.entry}</td>
                <td className={TD}>{r.mark}</td>
                <td className={TD}>{r.closeout}</td>
                <td className={`${TD} ${FIG} ${r.loss ? "text-ember" : "text-glow"}`}><Term label={r.pnl} tip={r.pnlTip} /></td>
                <td className={TD}>{r.hold}</td>
                <td className={TD}>{r.falls === null ? r.fee : <Term label={r.fee} tip={r.feeTip} />}</td>
                <td className={`${TD} ${FIG}`}>{r.noFee ? <Term label={r.feeUsd} tip="No profit fee on this close: it realises a loss or nothing." /> : r.feeUsd}</td>
                <td className={`${TD} ${FIG}`}>{r.proceeds}</td>
                <td className={`${TD} text-right`}>
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
