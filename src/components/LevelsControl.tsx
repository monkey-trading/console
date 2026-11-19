"use client";

/**
 * A position's take profit and stop loss as the control that opens its levels dialog (from V79): "Add" while it holds
 * neither, else the levels themselves, the take profit over the stop loss in the table's cell and on one line on the card.
 * One button in every state, so focus returns to it when a save adds or removes the levels.
 */

/**
 * The take profit and stop loss: as wide as a six-digit price with two decimals and its separators ("100,300.00", 10 characters),
 * plus two characters' room. A level set with more digits, up to "999,999,999.999999999", wraps inside the column, every digit
 * shown, so the table keeps to the 740 px pane; it is the one cell whose height a figure can grow.
 */
export const LEVEL_W = "max-w-[12ch] whitespace-normal [overflow-wrap:anywhere]";
/** The console's link style; while unavailable it reads as plain text, so the levels stay legible. */
const LINK = "text-left text-glow underline hover:text-glow-hover focus-visible:outline-2 focus-visible:outline-glow disabled:text-inherit disabled:no-underline";

interface Props {
  id: string;
  symbol: string;
  long: boolean;
  /** Each level as the table shows it, or null while it is not set. */
  takeProfit: string | null;
  stopLoss: string | null;
  layout: "row" | "card";
  disabled: boolean;
  describedBy: string | undefined;
  onClick: () => void;
}

export function LevelsControl({ id, symbol, long, takeProfit, stopLoss, layout, disabled, describedBy, onClick }: Props) {
  const none = takeProfit === null && stopLoss === null;
  const position = `your ${symbol} ${long ? "long" : "short"} position`;
  // The name holds the levels shown, so the control is named by what it shows (WCAG 2.5.3).
  const name = none
    ? `Add take profit and stop loss for ${position}`
    : `Change take profit and stop loss for ${position}: ${takeProfit === null ? "no take profit" : `take profit ${takeProfit}`}, ${stopLoss === null ? "no stop loss" : `stop loss ${stopLoss}`}`;
  const shown = none ? "Add"
    : layout === "card" ? `${takeProfit ?? "—"} / ${stopLoss ?? "—"}`
      : <><span className={`block ${LEVEL_W}`}>{takeProfit ?? "—"}</span><span className={`block min-h-lh text-label ${LEVEL_W}`}>{stopLoss ?? "—"}</span></>;
  return (
    <>
      <button type="button" id={id} disabled={disabled} aria-describedby={describedBy} aria-haspopup="dialog" aria-label={name} onClick={onClick}
        className={`${LINK} ${layout === "card" ? "inline-block min-h-6 min-w-6 [overflow-wrap:anywhere]" : "block w-fit"}`}>
        {shown}
      </button>
      {/* "Add" takes the cell's first line; its second stays, as every cell's does. */}
      {layout === "row" && none && <span className="block min-h-lh text-label" />}
    </>
  );
}
