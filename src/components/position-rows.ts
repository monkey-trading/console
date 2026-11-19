/**
 * The Positions tab's rows: each position's figures at its closing price, its hold and profit fee, its levels control and
 * its Close button with the price it sends. From V84 a hedged position's Close says when closing it alone would be refused.
 */

import { CLOSE_SLIPPAGE_BPS } from "@/lib/close-all";
import type { Reject } from "@/lib/engine/types";
import { describeNextFall, describeNextFallShort, formatHold, type FeeTerms } from "@/lib/fee-words";
import { formatRate } from "@/lib/format";
import { describeDetails, describeNoClose, describeNoPrice, describePnl, type CloseGaps } from "@/lib/pnl-words";
import { stressTermsAt } from "@/lib/pricing";
import { formatCloseout, formatMark } from "@/lib/price-format";
import { absFixed, formatFixedPlaces, formatUsd } from "@/lib/fixed";
import { roundToPlaces } from "@/lib/fixed-rounding";
import { realisedAt } from "@/lib/close-preview";
import type { HouseParams } from "@/lib/house";
import type { HeldPosition } from "@/lib/level-draft";
import { formatLevel, NO_LEVELS, offeredLevelDistance, type Levels } from "@/lib/levels";
import type { LevelFields } from "@/lib/level-check";
import { levelsWait } from "@/lib/level-words";
import { editorReference } from "@/lib/ticket-levels";
import type { PositionModel } from "@/lib/models";
import { describeLoneClose } from "@/lib/portfolio-words";
import { closingPrice } from "@/lib/quotes";
import { placeOrder } from "@/lib/store/actions";
import type { ConsoleState } from "@/lib/store/state";
import type { ConsoleStore } from "@/lib/store/store";
import { previewTicket, unrealisedPnl, usdConverter } from "@/lib/ticket";
import { CLOSE_WAITS, houseTermsNote, positionClose, positionFeeNow } from "@/lib/ticket-figures";
import { closeDeclined, isMarginRefusal } from "@/lib/ticket-portfolio";
import { accountPricing, ticketLimits } from "@/lib/tier-view";
import { isPriced } from "@/lib/unpriced";

import { keepFocus } from "./keep-focus";
import type { useLevelsEditor } from "./use-levels-editor";

/** What the rows read beyond each position: the console's state, the session's store, the read-only gate, the levels dialog, the fee terms and, in a simulated build, the in-browser node's verdict on closing a hedged position alone. */
export interface RowContext {
  snapshot: ConsoleState;
  store: ConsoleStore;
  readOnly: { readOnly: boolean; describedBy: string | undefined };
  levelsEditor: ReturnType<typeof useLevelsEditor>;
  heldOf: (p: PositionModel) => HeldPosition;
  terms: HouseParams | null;
  feeTerms: FeeTerms | null;
  simulatedDecline: (market: number) => Reject | null;
}

/** Each position's row, in the account's order. */
export function positionRows(ctx: RowContext, positions: readonly PositionModel[]) {
  const { snapshot, store, readOnly, levelsEditor, heldOf, terms, feeTerms } = ctx;
  const { account, markets, busy, signatures, quotes, house, quoted: asked, now } = snapshot;
  return positions.map((p) => {
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
    // Closing a hedged position alone is refused when it raises the margin past the equity (V84, D7): a live node's exact close
    // quote says so, and in a simulated build the in-browser node's preview of the same close.
    const declined = signatures === "checked" ? closeDeclined(quote, side, qty) : ctx.simulatedDecline(p.market);
    const loneRefused = isMarginRefusal(declined) ? describeLoneClose(String(market?.symbol ?? p.market)) : null;
    const slippageBps = Math.min(CLOSE_SLIPPAGE_BPS, market?.view.max_slippage_bps ?? CLOSE_SLIPPAGE_BPS);
    const close = (event: { currentTarget: HTMLElement }) => {
      if (quoted === null) return;
      keepFocus(event.currentTarget);
      void placeOrder(store, { market: p.market, side, qty, kind: { kind: "market", quoted, slippageBps }, reduceOnly: true }, "positions");
    };
    // From V79 a position in a market that takes levels shows them and a dialog to set, move or remove them, measured from its closing price.
    const levels = p.levels ?? NO_LEVELS;
    const draft = levelsEditor.draftFor(p.market);
    const editor = market === undefined || offeredLevelDistance(market.view, snapshot.protocolVersion) === null ? null : {
      market, position: p, ...editorReference(account, terms, market, p.qty, known === null ? null : quoted), noClosing: levelsWait(noPrice ?? houseTermsNote(snapshot)),
      limits: ticketLimits(account, p.market), toUsdDown, fields: draft?.fields ?? { takeProfit: "", stopLoss: "" }, onChange: levelsEditor.edit,
      onCancel: levelsEditor.cancel, onSend: (sent: Levels) => { if (draft !== null) levelsEditor.sending(draft.instance, p.market, sent); }, onSaved: (sent: LevelFields, words: string) => { if (draft !== null) levelsEditor.saved(draft.instance, sent, words); },
      saving: levelsEditor.savingFor(p.market), onSettled: () => { if (draft !== null) levelsEditor.settled(draft.instance); }, onRemovedWithFocus: levelsEditor.removedWithFocus, announced: levelsEditor.announcedFor(p.market),
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
      holdsLevels: p.levels !== undefined,
      editor,
      editing: editor !== null && draft !== null,
      // The levels, or Add, open the dialog; a market that takes no levels shows dashes, as its card leaves them out.
      control: {
        symbol: String(market?.symbol ?? p.market), long: p.qty > 0n, takeProfit: levels.takeProfit === null ? null : formatLevel(levels.takeProfit, places),
        stopLoss: levels.stopLoss === null ? null : formatLevel(levels.stopLoss, places), disabled: busy || readOnly.readOnly, describedBy: readOnly.describedBy, onClick: () => levelsEditor.openFor(heldOf(p)),
      },
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
      closable: !busy && !readOnly.readOnly && market?.open === true && known !== null && quoted !== null && loneRefused === null,
      loneRefused,
      // What Close hedge reads of the position: whether its market can trade, and its own Close button's price, else the mark.
      member: { market: p.market, symbol: String(market?.symbol ?? p.market), open: market?.open === true && isPriced(market), quoted: known === null ? null : quoted, mark: known },
      // The node quotes at most four markets at once, the selected one first; a held market left out has no closing price until it is selected.
      unquoted: signatures === "checked" && !asked.includes(p.market) && market?.open === true && known !== null,
      close,
    };
  });
}

/** One position's row. */
export type PositionRow = ReturnType<typeof positionRows>[number];
