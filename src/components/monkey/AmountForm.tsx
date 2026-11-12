"use client";

/**
 * One MONKEY amount field with a Max button and its submit. What is typed is kept for the account it
 * was typed for — by the page's store (the stake fields) or by an owner passed in (the Delegate tab's
 * per-row editors) — so a gap in the feed does not lose it; a transaction that lands clears the field
 * as it lands, unless something else has been typed since. `preview` says what a valid amount would
 * change, under the field, before the wallet is asked.
 */

import { useId, type ReactNode } from "react";

import { monkeyInputText, parseMonkeyAmount } from "@/lib/monkey/figures";
import type { DraftField } from "@/lib/monkey/panel-state";

import { AMOUNT_INPUT } from "../amount-input";
import { BUTTON } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

/** What is typed in the field and how it is kept and cleared, for an owner that is not the page's store. */
export interface AmountDraft {
  text: string;
  set: (text: string) => void;
  /** Clears what was sent once it has landed, unless something else has been typed since. */
  clear: (sent: string) => void;
}

interface CommonProps {
  label: string;
  action: string;
  /** The most the account can put in, in base units, which the Max button fills. */
  max: bigint;
  maxLabel: string;
  disabled: boolean;
  /** Sends the transaction; `onLanded` clears the field the moment it has landed. */
  onSubmit: (amount: bigint, onLanded: () => void) => Promise<unknown>;
  /** What a valid amount would change; nothing while the field is empty or wrong. */
  preview?: (amount: bigint) => ReactNode;
}

/** Either the field the page's store keeps, or a draft an owner keeps (never both). */
export type AmountFormProps = CommonProps & ({ field: DraftField; draft?: undefined } | { draft: AmountDraft; field?: undefined });

/** Longer than any supply plus eighteen places, so a pasted string cannot be parsed to a huge number on every render. */
const MAX_AMOUNT_CHARS = 40;

const INPUT = "min-h-11 min-w-0 flex-[1_1_6rem] rounded border border-line-2 bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";

export function AmountForm(props: AmountFormProps) {
  const { label, action, max, maxLabel, disabled, onSubmit, preview } = props;
  const external = props.draft;
  const field = props.field;
  const id = useId();
  const panel = useMonkeyPanel();
  const { drafts } = usePanelState();
  const account = useConsoleSelect((state) => state.wallet?.address ?? null);
  // Text typed for another account is not this one's.
  const text = external !== undefined ? external.text : field !== undefined && drafts.account === account ? drafts[field] : "";
  const setText = (next: string) => {
    if (external !== undefined) external.set(next);
    else if (field !== undefined) panel.setDraft(field, next);
  };
  const amount = parseMonkeyAmount(text);
  const problem = text.trim() === "" ? null : amount === null ? "Enter an amount of MONKEY with up to 18 decimal places." : amount > max ? `That is more than ${maxLabel}.` : null;
  const ok = amount !== null && problem === null && !disabled;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) {
          void onSubmit(amount, () => {
            if (external !== undefined) external.clear(text);
            else if (field !== undefined) panel.clearDraft(field, text);
          });
        }
      }}
      className="space-y-1"
    >
      <label htmlFor={id} className="text-label tracking-caps text-fg-3 uppercase">{label}</label>
      {/* The buttons keep their width and the field gives way to a second line, so the form fits any width and enlarged text. */}
      <div className="flex flex-wrap gap-2">
        <input {...AMOUNT_INPUT} id={id} value={text} maxLength={MAX_AMOUNT_CHARS} onChange={(event) => setText(event.target.value)} inputMode="decimal" spellCheck={false} placeholder="0.0" aria-invalid={problem !== null} aria-describedby={problem === null ? undefined : `${id}-problem`} className={INPUT} />
        <button type="button" onClick={() => { if (max > 0n) setText(monkeyInputText(max)); }} aria-disabled={max <= 0n} className="min-h-11 rounded border border-line-2 px-2 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:text-fg-3 lg:min-h-0">Max<span className="sr-only"> {maxLabel}</span></button>
        <button type="submit" aria-disabled={!ok} className={BUTTON}>{action}</button>
      </div>
      {problem !== null && <p id={`${id}-problem`} role="status" className="text-caption text-amber">{problem}</p>}
      {/* One live line that changes its words as the amount does, so the change is heard before the wallet opens. */}
      {preview !== undefined && <div role="status" className="text-caption leading-relaxed text-fg-2">{amount !== null && problem === null && amount > 0n ? preview(amount) : null}</div>}
    </form>
  );
}
