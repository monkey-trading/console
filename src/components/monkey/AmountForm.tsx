"use client";

/** One MONKEY amount field with a Max button and its submit; a landed transaction clears the field. */

import { useId, useState } from "react";

import { monkeyInputText, parseMonkeyAmount } from "@/lib/monkey/figures";

import { BUTTON } from "./styles";

interface Props {
  label: string;
  action: string;
  /** The most the account can put in, in base units, which the Max button fills. */
  max: bigint;
  maxLabel: string;
  disabled: boolean;
  onSubmit: (amount: bigint) => Promise<boolean>;
}

/** Longer than any supply plus eighteen places, so a pasted string cannot be parsed to a huge number on every render. */
const MAX_AMOUNT_CHARS = 40;

const INPUT = "min-h-11 min-w-0 flex-1 rounded border border-line-2 bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";

export function AmountForm({ label, action, max, maxLabel, disabled, onSubmit }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const amount = parseMonkeyAmount(text);
  const problem = text.trim() === "" ? null : amount === null ? "Enter an amount of MONKEY with up to 18 decimal places." : amount > max ? `That is more than ${maxLabel}.` : null;
  const ok = amount !== null && problem === null && !disabled;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) void onSubmit(amount).then((landed) => { if (landed) setText(""); });
      }}
      className="space-y-1"
    >
      <label htmlFor={id} className="text-label tracking-caps text-fg-3 uppercase">{label}</label>
      <div className="flex gap-2">
        <input id={id} value={text} maxLength={MAX_AMOUNT_CHARS} onChange={(event) => setText(event.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.0" aria-invalid={problem !== null} aria-describedby={problem === null ? undefined : `${id}-problem`} className={INPUT} />
        <button type="button" onClick={() => { if (max > 0n) setText(monkeyInputText(max)); }} aria-disabled={max <= 0n} className="min-h-11 rounded border border-line-2 px-2 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:text-fg-3 lg:min-h-0">Max<span className="sr-only"> {maxLabel}</span></button>
        <button type="submit" aria-disabled={!ok} className={BUTTON}>{action}</button>
      </div>
      {problem !== null && <p id={`${id}-problem`} role="status" className="text-caption text-amber">{problem}</p>}
    </form>
  );
}
