"use client";

/**
 * One MONKEY amount field with a Max button and its submit. What is typed is kept by the page's
 * store, so a gap in the feed does not lose it; a transaction that lands clears the field as it
 * lands, unless something else has been typed since.
 */

import { useId } from "react";

import { monkeyInputText, parseMonkeyAmount } from "@/lib/monkey/figures";

import { AMOUNT_INPUT } from "../amount-input";
import { BUTTON } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

interface Props {
  field: "stake" | "unstake";
  label: string;
  action: string;
  /** The most the account can put in, in base units, which the Max button fills. */
  max: bigint;
  maxLabel: string;
  disabled: boolean;
  /** Sends the transaction; `onLanded` clears the field the moment it has landed. */
  onSubmit: (amount: bigint, onLanded: () => void) => Promise<unknown>;
}

/** Longer than any supply plus eighteen places, so a pasted string cannot be parsed to a huge number on every render. */
const MAX_AMOUNT_CHARS = 40;

const INPUT = "min-h-11 min-w-0 flex-1 rounded border border-line-2 bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";

export function AmountForm({ field, label, action, max, maxLabel, disabled, onSubmit }: Props) {
  const id = useId();
  const panel = useMonkeyPanel();
  const { drafts } = usePanelState();
  const account = useConsoleSelect((state) => state.wallet?.address ?? null);
  // Text typed for another account is not this one's.
  const text = drafts.account === account ? drafts[field] : "";
  const setText = (next: string) => panel.setDraft(field, next);
  const amount = parseMonkeyAmount(text);
  const problem = text.trim() === "" ? null : amount === null ? "Enter an amount of MONKEY with up to 18 decimal places." : amount > max ? `That is more than ${maxLabel}.` : null;
  const ok = amount !== null && problem === null && !disabled;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) void onSubmit(amount, () => panel.clearDraft(field, text));
      }}
      className="space-y-1"
    >
      <label htmlFor={id} className="text-label tracking-caps text-fg-3 uppercase">{label}</label>
      <div className="flex gap-2">
        <input {...AMOUNT_INPUT} id={id} value={text} maxLength={MAX_AMOUNT_CHARS} onChange={(event) => setText(event.target.value)} inputMode="decimal" spellCheck={false} placeholder="0.0" aria-invalid={problem !== null} aria-describedby={problem === null ? undefined : `${id}-problem`} className={INPUT} />
        <button type="button" onClick={() => { if (max > 0n) setText(monkeyInputText(max)); }} aria-disabled={max <= 0n} className="min-h-11 rounded border border-line-2 px-2 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:text-fg-3 lg:min-h-0">Max<span className="sr-only"> {maxLabel}</span></button>
        <button type="submit" aria-disabled={!ok} className={BUTTON}>{action}</button>
      </div>
      {problem !== null && <p id={`${id}-problem`} role="status" className="text-caption text-amber">{problem}</p>}
    </form>
  );
}
