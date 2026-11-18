"use client";

/**
 * Open positions with their profit and loss at the closing price, hold, profit fee, take profit and stop loss, and what a close keeps, a Close
 * and an Edit button each and a Close all above them: a table of one row each from 1024 px, cards below. A row's cells hold two lines each,
 * so the table fits the 740 px centre pane of a 1280 px screen with its buttons in view. Edit opens the levels' editor under its row.
 */

import { Fragment, useEffect, useId } from "react";

import { CONFIRM_MIN_GAP_MS, CONFIRM_MS } from "@/lib/confirm-window";
import { describeLeftOut, planCloseAll, pressBatch, targetsKey } from "@/lib/close-all";
import { describeNextFall, describeNextFallShort, describeSchedule, formatHold } from "@/lib/fee-words";
import { formatRate } from "@/lib/format";
import { describeDetails, describeNoClose, describeNoPrice, describePnl, type CloseGaps } from "@/lib/pnl-words";
import { CALM, stressTermsAt } from "@/lib/pricing";
import { formatCloseout, formatMark } from "@/lib/price-format";
import { absFixed, formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { roundToPlaces } from "@/lib/fixed-rounding";
import { realisedAt } from "@/lib/close-preview";
import { formatLevel, minLevelDistance, NO_LEVELS } from "@/lib/levels";
import type { LevelFields } from "@/lib/level-check";
import { CLOSE_ALL_REMOVES_LEVELS } from "@/lib/level-words";
import { closingAt } from "@/lib/ticket-levels";
import { closingPrice } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import { closeAll } from "@/lib/store/batch-actions";
import { previewTicket, unrealisedPnl, usdConverter } from "@/lib/ticket";
import { accountFeeTerms, CLOSE_WAITS, currentParams, positionClose, positionFeeNow } from "@/lib/ticket-figures";
import { accountPricing, ticketLimits } from "@/lib/tier-view";

import { useConsole, useSession } from "./ConsoleProvider";
import { keepFocus } from "./keep-focus";
import { LevelsEditor } from "./LevelsEditor";
import { Notice } from "./Notice";
import { useReadOnlyNote } from "./SignGate";
import { Term } from "./house/Panel";
import { useConfirmWindow } from "./use-confirm-window";
import { editButtonIds, useLevelsEditor } from "./use-levels-editor";
import { usePrefs } from "./use-prefs";

const TH = "whitespace-nowrap px-1.5 py-2 text-left align-bottom text-label font-normal tracking-caps text-fg-3 uppercase";
/** A body cell: at most two lines, each always mounted, so a row's height never depends on its figures. */
const TD = "whitespace-nowrap px-1.5 py-1.5";
/** A cell's second line: it keeps its line when it holds nothing. */
const SUB = "block min-h-lh text-label text-fg-3";
/**
 * A column's width, so a withheld figure ("—") and a shown one take the same room: the longest value it holds, in the cell's own font,
 * plus the cell's padding (0.75rem). P&L: the longest figure below $1,000,000 with its sign and bound mark ("≥ -$123,456.78" is 14 characters
 * in Close now, "≤ $123,456.78" 13 in Fee (USD)); the profit fee's second line: "Falls in 14m 00s" or "Falls in 29d 23h", 16 characters at the label size.
 */
const PNL_W = "min-w-[12ch]";
const FEE_W = "min-w-[calc(13ch+0.75rem)]";
const CLOSE_W = "min-w-[calc(14ch+0.75rem)]";
const RATE_W = "min-w-[16ch]";
const BUTTON = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";
/** The table's Close button sits under its figure, with the gap a second line would take. */
const CELL_BUTTON = `${BUTTON} mt-1`;
/** The table's Edit button beside Close, its padding and gap a little tighter so the row stays inside the 740 px pane at six-digit prices. */
const EDIT_BUTTON = "mt-1 ml-0.5 min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0 lg:px-1.5";
/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** What the Close-out value means, shared by the table's head and the phone rows' label. */
const CLOSEOUT_TIP = "The price at which your account would be closed out, assuming your other positions remain at their current prices. Because margin is shared across your account, your largest losing position is closed first, and that may not be this one. Due means your account is already below the close-out level. None means no realistic price would close out your account.";

/** What the P&L column means, shared by the table's head and the phone rows' labels. */
const PNL_TIP = "The profit or loss you would realise by closing the entire position now, before the profit fee. It is calculated at the price at which the position would close (the bid for a long position, the offer for a short), so the spread is already taken into account. Details shows the profit or loss at the mark price.";

/** What the hold, fee and close columns mean, shared by the table's head and the phone rows' labels. */
const HOLD_TIP = "The length of time the position has been open, which determines its profit fee rate. Adding to a position reduces its holding time in proportion to the size added. Reducing a position leaves it unchanged.";
const NO_FEE_NOTE = "No fee without a profit";
const FEE_USD_TIP = "The profit fee, in USD, that you would pay by closing the entire position now. No fee is charged when a position is closed without a profit. A ≤ sign means the fee rate is about to fall, so the fee may be lower if the price holds.";
const CLOSE_TIP = "The amount that closing the entire position now would add to or deduct from your balance, which is the profit or loss at the closing price less the profit fee. This figure changes as prices move. A ≥ sign means the fee rate is about to fall, so you may keep more.";
const LEVELS_TIP = "The levels at which the entire position is closed automatically. A take profit or stop loss is triggered when the price at which the position would close reaches it.";

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
  // The one levels editor, under the row of the position it is open for, and its draft.
  const levelsEditor = useLevelsEditor(store, id);
  const positions = account?.positions ?? [];
  const feeTip = `This is the fee rate paid on a winning trade. ${feeTerms === null ? "The fee rate falls the longer the position is held." : describeSchedule(feeTerms)}`;
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
    const falls = fee === null ? null : describeNextFall(fee, feeTerms?.profitFeeBps ?? null, now);
    const fallsShort = fee === null ? null : describeNextFallShort(fee, feeTerms?.profitFeeBps ?? null, now);
    const feeBps = fee?.feeBps ?? feeTerms?.profitFeeBps ?? null;
    const quoted = signatures === "checked"
      ? (quote === undefined ? null : closingPrice(quote, side, qty))
      : market === undefined ? null : (previewTicket({ market, side, qty, slippageBps: CLOSE_SLIPPAGE_BPS, account, houseNav: house.nav, stress: stressTermsAt(terms?.stressLevels, market.stress), closeFeeBps: feeBps ?? undefined, ...accountPricing(account, terms, market.view) }).quote?.price ?? null);
    // The node's whole-close quote is exact, as is the mock's own price, which its fill uses.
    const { close: closeNow, why: withheld } = positionClose(snapshot, market, p, quoted);
    // The P&L is what the close realises at its price, whatever the fee's terms: a close that has no price shows none, and the figure at the mark stays in its explanation.
    const toUsdDown = market === undefined || known === null ? null : usdConverter(market.view, known, "down");
    const pnl = market?.open === true && quoted !== null && toUsdDown !== null ? realisedAt(p.qty, p.entry, qty, quoted, toUsdDown) : null;
    const gaps: CloseGaps = {
      symbol: String(market?.symbol ?? p.market), open: market?.open === true, marked: known !== null, converts: toUsdDown !== null, quoted: quoted !== null,
      asked: signatures !== "checked" || asked.includes(p.market), termsCurrent: snapshot.pricingCurrent, houseNote: withheld, rateRead: feeBps !== null,
    };
    // Why a figure that needs a price, or the fee's terms, is withheld.
    const noPrice = describeNoPrice(gaps);
    const noClose = closeNow === null ? describeNoClose(gaps) ?? CLOSE_WAITS : null;
    const noFee = closeNow !== null && closeNow.fee === 0n && closeNow.realised <= 0n;
    const slippageBps = Math.min(CLOSE_SLIPPAGE_BPS, market?.view.max_slippage_bps ?? CLOSE_SLIPPAGE_BPS);
    const close = (event: { currentTarget: HTMLElement }) => {
      if (quoted === null) return;
      keepFocus(event.currentTarget);
      void placeOrder(store, { market: p.market, side, qty, kind: { kind: "market", quoted, slippageBps }, reduceOnly: true }, "positions");
    };
    // From V79 a position in a market that takes levels shows them and an editor to set, move or remove them, measured from its closing price.
    const levels = p.levels ?? NO_LEVELS;
    // The node's exact whole close where it quotes one, else the console's own at the mark, as the engine measures from the last mark while the market is shut.
    const estimate = market === undefined ? null : closingAt(market, p.qty, { tiers: accountPricing(account, terms, market.view).spreadTiers ?? market.view.spread_tiers, stress: stressTermsAt(terms?.stressLevels, market.stress) ?? CALM, toxicityBps: account?.toxicity?.addOnBps ?? 0 });
    const draft = levelsEditor.draft?.market === p.market ? levelsEditor.draft : null;
    const editor = market === undefined || minLevelDistance(market.view) === null ? null : {
      market, position: p, closing: known === null ? null : quoted ?? estimate, noClosing: `The take profit and stop loss cannot be checked at the moment. ${noPrice ?? CLOSE_WAITS}`,
      limits: ticketLimits(account, p.market), toUsdDown, fields: draft?.fields ?? { takeProfit: "", stopLoss: "" }, onChange: levelsEditor.edit,
      onCancel: () => levelsEditor.cancel(p.market), onSaved: (sent: LevelFields, words: string) => { if (draft !== null) levelsEditor.saved(draft.instance, sent, p.market, words); },
    };
    return {
      key: p.market,
      symbol: String(market?.symbol ?? p.market),
      long: p.qty > 0n,
      size: formatFixedPlaces(absFixed(p.qty), 6),
      entry: formatMark(p.entry, places),
      mark: known === null ? "—" : formatMark(known, places),
      pnl: pnl === null ? "—" : formatUsd(pnl),
      // A fee that may still change is an upper bound, rounded up the way "at most" reads.
      feeUsd: closeNow === null ? "—" : closeNow.exact || closeNow.fee === 0n ? formatUsd(closeNow.fee) : `≤ ${formatUsd(roundToPlaces(closeNow.fee, 2, "up"))}`,
      noFee,
      // One static-named explanation per row, so no live figure is the name of a control.
      details: describeDetails({ pnl: describePnl(atMark === null ? null : formatUsd(atMark), pnl === null ? noPrice : null), noClose, noFee }),
      closeout: formatCloseout(p.closeout, places),
      // A market that takes no levels shows none, as its card leaves them out.
      takeProfit: levels.takeProfit === null || editor === null ? "—" : formatLevel(levels.takeProfit, places),
      stopLoss: levels.stopLoss === null || editor === null ? "—" : formatLevel(levels.stopLoss, places),
      holdsLevels: p.levels !== undefined,
      editor,
      editing: editor !== null && draft !== null,
      edit: () => levelsEditor.toggle(p.market, levels),
      hold: fee === null ? "—" : formatHold(fee.holdMs),
      fee: feeBps === null ? "—" : formatRate(feeBps),
      falls,
      fallsShort,
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
  const { targets, leftOut } = planCloseAll(rows.map((r) => ({ market: r.key, symbol: r.symbol, open: r.open, quoted: r.quoted, select: r.unquoted })));
  const count = targets.length;
  const leftOutNote = describeLeftOut(leftOut);
  const confirming = armed && count > 0;
  const removesLevels = targets.some((target) => rows.find((r) => r.key === target.market)?.holdsLevels === true);
  // The window confirms the list it was armed for: when the markets Close all would send change, it closes and the next press arms again.
  const listed = targetsKey(targets);
  useEffect(() => cancel(), [listed, cancel]);
  // An account that could not be read (the panel above says so) shows no positions, rather than none as if it had none.
  if (account === null && notices.accountRead !== undefined) return <p className="px-4 py-6 text-caption text-fg-3">Your positions will be shown once your account has loaded.</p>;
  if (positions.length === 0) return <><p className="px-4 py-6 text-caption text-fg-3">You have no open positions.</p><div className="px-4 has-[p]:pb-3"><Notice surface="positions" /></div></>;
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
        <p role="status" className="sr-only">{confirming ? `Press again within ${CONFIRM_MS / 1000} seconds to close ${count} ${count === 1 ? "position" : "positions"}.${removesLevels ? ` ${CLOSE_ALL_REMOVES_LEVELS}` : ""}` : ""}</p>
        {confirming && removesLevels && <p className="text-label leading-relaxed text-fg-2">{CLOSE_ALL_REMOVES_LEVELS}</p>}
        {leftOutNote !== null && <p id={noteId} className="text-label leading-relaxed text-fg-3">{leftOutNote}</p>}
      </div>
      <div className="px-4 has-[p]:border-b has-[p]:border-line has-[p]:pb-3"><Notice surface="positions" /></div>
      <p role="status" className="sr-only">{levelsEditor.announced}</p>
      <ul className="lg:hidden">
        {rows.map((r) => (
          <li key={r.key} className="border-b border-line px-4 py-3 text-caption last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <p><span className="text-fg">{r.symbol}</span> <span className={r.long ? "text-glow" : "text-ember"}>{r.long ? "Long" : "Short"}</span></p>
              <p className={r.loss ? "text-ember" : "text-glow"}><span className="sr-only">Profit and loss </span>{r.pnl} <span className="ml-2 text-label text-fg-3"><Term label="Details" tip={r.details} /></span></p>
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-fg-2">
              <div><dt className="text-label text-fg-3">Size</dt><dd>{r.size}</dd></div>
              <div><dt className="text-label text-fg-3">Entry</dt><dd>{r.entry}</dd></div>
              <div><dt className="text-label text-fg-3">Mark</dt><dd>{r.mark}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Close-out" tip={CLOSEOUT_TIP} /></dt><dd>{r.closeout}</dd></div>
              {r.editor !== null && <div><dt className="text-label text-fg-3"><Term label="Take profit" tip={LEVELS_TIP} /></dt><dd>{r.takeProfit}</dd></div>}
              {r.editor !== null && <div><dt className="text-label text-fg-3">Stop loss</dt><dd>{r.stopLoss}</dd></div>}
              <div><dt className="text-label text-fg-3"><Term label="Held" tip={HOLD_TIP} /></dt><dd>{r.hold}</dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Profit fee" tip={feeTip} /></dt><dd>{r.fee}<span className={SUB}>{r.falls}</span></dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Fee (USD)" tip={FEE_USD_TIP} /></dt><dd>{r.feeUsd}<span aria-hidden={!r.noFee} className={`block text-label ${r.noFee ? "text-fg-3" : "invisible"}`}>{NO_FEE_NOTE}</span></dd></div>
              <div><dt className="text-label text-fg-3"><Term label="Close now" tip={CLOSE_TIP} /></dt><dd>{r.proceeds}</dd></div>
            </dl>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={!r.closable} className={`${BUTTON} flex-1`} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
              {r.editor !== null && <button type="button" id={editButtonIds(id, r.key)[1]} className={`${BUTTON} flex-1`} aria-expanded={r.editing} aria-controls={r.editing ? `${id}-levels-card` : undefined} aria-label={`Edit take profit and stop loss for ${r.symbol} position`} onClick={r.edit}>Edit take profit and stop loss</button>}
            </div>
            <p aria-hidden={!r.unquoted} className={`mt-2 text-label ${r.unquoted ? "text-fg-3" : "invisible"}`}>Select {r.symbol} in the watchlist to load its closing price.</p>
            {r.editing && r.editor !== null && <LevelsEditor id={`${id}-levels-card`} {...r.editor} readOnly={readOnly.readOnly} describedBy={readOnly.describedBy} />}
          </li>
        ))}
      </ul>
      <div role="region" aria-label="Open positions" tabIndex={0} className="relative hidden overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:block">
        <table className="w-full min-w-max text-caption">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}><span className="block">Market</span><span className="block">Side</span></th>
              <th className={TH}><span className="block">Size</span><span className="block"><Term label="Held" tip={HOLD_TIP} /></span></th>
              <th className={TH}><span className="block">Entry</span><span className="block">Mark</span></th>
              <th className={TH}><span className="block"><Term label="Take profit" tip={LEVELS_TIP} /></span><span className="block">Stop loss</span></th><th className={TH}><Term label="P&L" tip={PNL_TIP} /></th>
              <th className={TH}><Term label="Profit fee" tip={feeTip} /></th><th className={TH}><span className="block"><Term label="Fee (USD)" tip={FEE_USD_TIP} /></span><span className="block"><Term label="Close-out" tip={CLOSEOUT_TIP} /></span></th><th className={TH}><Term label="Close now" tip={CLOSE_TIP} /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.key}>
              <tr className="border-b border-line last:border-b-0">
                <td className={TD}><span className="block text-fg">{r.symbol}</span><span className={`block min-h-lh text-label ${r.long ? "text-glow" : "text-ember"}`}>{r.long ? "Long" : "Short"}</span></td>
                <td className={TD}><span className="block">{r.size}</span><span className={SUB}><span className="sr-only">Held </span>{r.hold}</span></td>
                <td className={TD}><span className="block">{r.entry}</span><span className={SUB}><span className="sr-only">Mark </span>{r.mark}</span></td>
                <td className={TD}><span className="block">{r.takeProfit}</span><span className={SUB}><span className="sr-only">Stop loss </span>{r.stopLoss}</span></td>
                <td className={`${TD} ${r.loss ? "text-ember" : "text-glow"}`}>
                  <span className={`block ${PNL_W}`}>{r.pnl}</span>
                  <span className={SUB}><Term label="Details" tip={r.details} /></span>
                </td>
                <td className={TD}>
                  <span className="block min-w-[8ch]">{r.fee}</span>
                  <span className={`${SUB} ${RATE_W}`}>
                    <span aria-hidden="true">{r.fallsShort}</span>
                    {r.falls !== null && <span className="sr-only">{r.falls}</span>}
                  </span>
                </td>
                <td className={`${TD} ${FEE_W}`}><span className="block">{r.feeUsd}</span><span className={SUB}><span className="sr-only">Close-out </span>{r.closeout}</span></td>
                <td className={`${TD} ${CLOSE_W}`}>
                  <span className="block">{r.proceeds}</span>
                  <button type="button" disabled={!r.closable} className={CELL_BUTTON} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy} onClick={r.close}>Close</button>
                  {r.editor !== null && <button type="button" id={editButtonIds(id, r.key)[0]} className={EDIT_BUTTON} aria-expanded={r.editing} aria-controls={r.editing ? `${id}-levels-row` : undefined} aria-label={`Edit take profit and stop loss for ${r.symbol} position`} onClick={r.edit}>Edit</button>}
                </td>
              </tr>
              {r.editing && r.editor !== null && <tr className="border-b border-line"><td colSpan={8}><LevelsEditor id={`${id}-levels-row`} {...r.editor} readOnly={readOnly.readOnly} describedBy={readOnly.describedBy} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
