"use client";

/**
 * Open positions with their profit and loss at the closing price, hold, profit fee, take profit and stop loss, and what a close keeps, a Close
 * button each and a Close all above them: a table of one row each from 1024 px, cards below. A row's cells hold two lines each, so the table
 * fits the 740 px centre pane of a 1280 px screen with its buttons in view. The levels, or Add, open the levels' dialog. Positions that hedge
 * each other and earn a margin offset (V81) are listed together under their hedge's heading, the others after them.
 */

import { useEffect, useId } from "react";

import { CONFIRM_MIN_GAP_MS, CONFIRM_MS } from "@/lib/confirm-window";
import { CLOSE_SLIPPAGE_BPS, describeLeftOut, planCloseAll, pressBatch, targetsKey } from "@/lib/close-all";
import { describeSchedule } from "@/lib/fee-words";
import { NO_LEVELS } from "@/lib/levels";
import { CLOSE_ALL_REMOVES_LEVELS } from "@/lib/level-words";
import type { PositionModel } from "@/lib/models";
import { creditedGroups } from "@/lib/portfolio";
import { HEDGED_CLOSEOUT_TIP, OTHER_POSITIONS } from "@/lib/portfolio-words";
import { closeAll } from "@/lib/store/batch-actions";
import { accountFeeTerms, currentParams } from "@/lib/ticket-figures";
import { closeRequests, previewKey } from "@/lib/ticket-portfolio";

import { useConsole, useSession } from "./ConsoleProvider";
import { flatPositions } from "./flat-positions";
import { HedgeHeading } from "./HedgeHeading";
import { keepFocus } from "./keep-focus";
import { LevelsControl, LEVEL_W } from "./LevelsControl";
import { LevelsEditor } from "./LevelsEditor";
import { Notice } from "./Notice";
import { positionRows, type PositionRow } from "./position-rows";
import { useReadOnlyNote } from "./SignGate";
import { Term } from "./house/Panel";
import { useConfirmWindow } from "./use-confirm-window";
import { levelsControlIds, useLevelsEditor } from "./use-levels-editor";
import { useOrderPreviews } from "./use-order-previews";
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
/** The button while it waits for its second press: the hover colours, held. */
const ARMED = "min-h-11 rounded border border-glow px-3 py-1 text-caption text-glow focus-visible:outline-2 focus-visible:outline-glow disabled:opacity-40 lg:min-h-0 lg:px-2";

/** What the Close-out value means, shared by the table's head and the phone rows' label. */
const CLOSEOUT_TIP = "The price at which your account would be closed out if only this market moved, or Due if it is below the close-out level. Because margin is shared, a close-out may close another of your positions first.";

/** What the P&L column means, shared by the table's head and the phone rows' labels. */
const PNL_TIP = "The profit or loss you would realise by closing the entire position now, before the profit fee. It is calculated at the price at which the position would close (the bid for a long position, the offer for a short), so the spread is already taken into account. Details shows the profit or loss at the mark price.";

/** What the hold, fee and close columns mean, shared by the table's head and the phone rows' labels. */
const HOLD_TIP = "The length of time the position has been open, which determines its profit fee rate. Adding to a position reduces its holding time in proportion to the size added. Reducing a position leaves it unchanged.";
const NO_FEE_NOTE = "No fee without a profit";
const FEE_USD_TIP = "The profit fee, in USD, that you would pay by closing the entire position now. No fee is charged when a position is closed without a profit. A ≤ sign means the fee rate is about to fall, so the fee may be lower if the price holds.";
const CLOSE_TIP = "The amount that closing the entire position now would add to or deduct from your balance, which is the profit or loss at the closing price less the profit fee. This figure changes as prices move. A ≥ sign means the fee rate is about to fall, so you may keep more.";
const LEVELS_TIP = "The levels at which the entire position is closed automatically. A take profit or stop loss is triggered when the price at which the position would close reaches it.";

export function PositionsView() {
  const snapshot = useConsole();
  const { account, busy, notices } = snapshot;
  // The house state's terms, only while current: a change to the fee may otherwise be unread.
  const terms = currentParams(snapshot);
  // What a close pays: the base less the account's tier's fee discount (V68), under the same curve.
  const feeTerms = accountFeeTerms(snapshot);
  const { store } = useSession();
  const id = useId();
  const readOnly = useReadOnlyNote(id, "Closing a position or editing its take profit and stop loss");
  const { armed, state, arm, cancel } = useConfirmWindow(CONFIRM_MS, CONFIRM_MIN_GAP_MS);
  const { confirmBatch } = usePrefs().prefs;
  const positions = account?.positions ?? [];
  // The one levels dialog, for the position it is open for, and its draft, which the account's position in that market owns.
  const heldOf = (p: PositionModel) => ({ market: p.market, levels: p.levels ?? NO_LEVELS });
  const held = positions.map(heldOf);
  const levelsEditor = useLevelsEditor(store, id, snapshot.wallet?.address.toLowerCase() ?? null, held);
  // A simulated build has no close quotes: the in-browser node previews each hedged position's close instead (V84, D7).
  const closes = closeRequests(snapshot);
  const verdicts = useOrderPreviews(store, closes, account, snapshot.now);
  const simulatedDecline = (market: number) => {
    const request = closes.find((c) => c.market === market);
    const answer = request === undefined ? undefined : verdicts.get(previewKey(request));
    return answer === undefined || answer === "failed" ? null : answer.refused;
  };
  const feeTip = `This is the fee rate paid on a winning trade. ${feeTerms === null ? "The fee rate falls the longer the position is held." : describeSchedule(feeTerms)}`;
  const rows = positionRows({ snapshot, store, readOnly, levelsEditor, heldOf, terms, feeTerms, simulatedDecline }, positions);
  // Each hedge that earns a margin offset, with its positions in the grid's order; every other position follows them.
  const hedges = creditedGroups(account?.portfolio).map((group) => ({ group, rows: group.members.flatMap((m) => rows.filter((r) => r.key === m)) }));
  const others = rows.filter((r) => !hedges.some((h) => h.rows.includes(r)));
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
  if (positions.length === 0) return <><p className="px-4 py-6 text-caption text-fg-3">You have no open positions.</p><div className="px-4 has-[p]:pb-3"><Notice surface="positions" /><Notice surface="levels" /></div></>;
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
  const editing = rows.find((r) => r.editing)?.editor ?? null;
  const closeoutTerm = hedges.length > 0 ? <Term label="Close-out" tip={HEDGED_CLOSEOUT_TIP} /> : <Term label="Close-out" tip={CLOSEOUT_TIP} />;
  const heading = (hedge: (typeof hedges)[number]) => <HedgeHeading group={hedge.group} members={hedge.rows.map((r) => r.member)} removesLevels={hedge.rows.some((r) => r.holdsLevels)} disabled={busy || readOnly.readOnly} describedBy={readOnly.describedBy} />;
  // A hedged position whose close alone would be refused says so at its Close button, which it describes.
  const loneId = (r: PositionRow, layout: "card" | "row") => (r.loneRefused === null ? undefined : `${id}-lone-${layout}-${r.key}`);
  const card = (r: PositionRow) => (
    <li key={`row-${r.key}`} className="border-b border-line px-4 py-3 text-caption last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <p><span className="text-fg">{r.symbol}</span> <span className={r.long ? "text-glow" : "text-ember"}>{r.long ? "Long" : "Short"}</span></p>
        <p className={r.loss ? "text-ember" : "text-glow"}><span className="sr-only">Profit and loss </span>{r.pnl} <span className="ml-2 text-label text-fg-3"><Term label="Details" tip={r.details} /></span></p>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-fg-2">
        <div><dt className="text-label text-fg-3">Size</dt><dd>{r.size}</dd></div>
        <div><dt className="text-label text-fg-3">Entry</dt><dd>{r.entry}</dd></div>
        <div><dt className="text-label text-fg-3">Mark</dt><dd>{r.mark}</dd></div>
        <div><dt className="text-label text-fg-3">{closeoutTerm}</dt><dd>{r.closeout}</dd></div>
        {r.editor !== null && <div><dt className="text-label text-fg-3"><Term label="Take profit / Stop loss" tip={LEVELS_TIP} /></dt><dd className="mt-1.5"><LevelsControl {...r.control} layout="card" id={levelsControlIds(id, r.key)[1]} /></dd></div>}
        <div><dt className="text-label text-fg-3"><Term label="Held" tip={HOLD_TIP} /></dt><dd>{r.hold}</dd></div>
        <div><dt className="text-label text-fg-3"><Term label="Profit fee" tip={feeTip} /></dt><dd>{r.fee}<span className={SUB}>{r.falls}</span></dd></div>
        <div><dt className="text-label text-fg-3"><Term label="Fee (USD)" tip={FEE_USD_TIP} /></dt><dd>{r.feeUsd}<span aria-hidden={!r.noFee} className={`block text-label ${r.noFee ? "text-fg-3" : "invisible"}`}>{NO_FEE_NOTE}</span></dd></div>
        <div><dt className="text-label text-fg-3"><Term label="Close now" tip={CLOSE_TIP} /></dt><dd>{r.proceeds}</dd></div>
      </dl>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!r.closable} className={`${BUTTON} flex-1`} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy ?? loneId(r, "card")} onClick={r.close}>Close</button>
      </div>
      {r.loneRefused !== null
        ? <p id={loneId(r, "card")} className="mt-2 text-label leading-relaxed text-fg-3">{r.loneRefused}</p>
        : <p aria-hidden={!r.unquoted} className={`mt-2 text-label ${r.unquoted ? "text-fg-3" : "invisible"}`}>Select {r.symbol} in the watchlist to load its closing price.</p>}
    </li>
  );
  const tableRow = (r: PositionRow) => [
    <tr key={`row-${r.key}`} className={r.loneRefused === null ? "border-b border-line last:border-b-0" : ""}>
      <td className={TD}><span className="block text-fg">{r.symbol}</span><span className={`block min-h-lh text-label ${r.long ? "text-glow" : "text-ember"}`}>{r.long ? "Long" : "Short"}</span></td>
      <td className={TD}><span className="block">{r.size}</span><span className={SUB}><span className="sr-only">Held </span>{r.hold}</span></td>
      <td className={TD}><span className="block">{r.entry}</span><span className={SUB}><span className="sr-only">Mark </span>{r.mark}</span></td>
      <td className={TD}>{r.editor === null
        ? <><span className={`block ${LEVEL_W}`}>—</span><span className={`${SUB} ${LEVEL_W}`}><span className="sr-only">Stop loss </span>—</span></>
        : <LevelsControl {...r.control} layout="row" id={levelsControlIds(id, r.key)[0]} />}</td>
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
        <button type="button" disabled={!r.closable} className={CELL_BUTTON} aria-label={`Close ${r.symbol} position`} aria-describedby={readOnly.describedBy ?? loneId(r, "row")} onClick={r.close}>Close</button>
      </td>
    </tr>,
    r.loneRefused === null ? null : <tr key={`note-${r.key}`} className="border-b border-line last:border-b-0"><td id={loneId(r, "row")} colSpan={8} className="px-1.5 pb-2 text-label leading-relaxed text-fg-3"><p className="max-w-[80ch] whitespace-normal">{r.loneRefused}</p></td></tr>,
  ];
  const othersHeading = hedges.length > 0 && others.length > 0;
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
      <div className="px-4 has-[p]:border-b has-[p]:border-line has-[p]:pb-3"><Notice surface="positions" />{!levelsEditor.open && <Notice surface="levels" />}</div>
      <p role="status" className="sr-only">{levelsEditor.announced}</p>
      <ul className="lg:hidden">
        {/* One flat list of headings and rows, each row keyed by its market, so a row that moves into or out of a hedge keeps its element and focus. */}
        {flatPositions(hedges.map((hedge) => ({ heading: <li key={`hedge-${hedge.group.name}`} className="border-b border-line px-4 py-3">{heading(hedge)}</li>, rows: hedge.rows })), { heading: othersHeading ? <li key="others" className="border-b border-line px-4 py-2 text-label tracking-caps text-fg-3 uppercase">{OTHER_POSITIONS}</li> : null, rows: others }, card)}
      </ul>
      <div role="region" aria-label="Open positions" tabIndex={0} className="relative hidden overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:block">
        <table className="w-full min-w-max text-caption">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}><span className="block">Market</span><span className="block">Side</span></th>
              <th className={TH}><span className="block">Size</span><span className="block"><Term label="Held" tip={HOLD_TIP} /></span></th>
              <th className={TH}><span className="block">Entry</span><span className="block">Mark</span></th>
              <th className={TH}><span className="block"><Term label="Take profit" tip={LEVELS_TIP} /></span><span className="block">Stop loss</span></th><th className={TH}><Term label="P&L" tip={PNL_TIP} /></th>
              <th className={TH}><Term label="Profit fee" tip={feeTip} /></th><th className={TH}><span className="block"><Term label="Fee (USD)" tip={FEE_USD_TIP} /></span><span className="block">{closeoutTerm}</span></th><th className={TH}><Term label="Close now" tip={CLOSE_TIP} /></th>
            </tr>
          </thead>
          <tbody>
            {flatPositions(hedges.map((hedge) => ({ heading: <tr key={`hedge-${hedge.group.name}`} className="border-b border-line"><th colSpan={8} className="px-1.5 py-2">{heading(hedge)}</th></tr>, rows: hedge.rows })), { heading: othersHeading ? <tr key="others" className="border-b border-line"><th colSpan={8} className={TH}>{OTHER_POSITIONS}</th></tr> : null, rows: others }, tableRow)}
          </tbody>
        </table>
      </div>
      {editing !== null && <LevelsEditor {...editing} readOnly={readOnly.readOnly} describedBy={readOnly.describedBy} />}
    </>
  );
}
