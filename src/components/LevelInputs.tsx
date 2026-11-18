"use client";

/** The take-profit and stop-loss fields the deal ticket and the position editor share: each level, what it would realise, and why it is refused. */

import { useId } from "react";

import type { LevelKind } from "@/lib/engine/types";
import { formatUsd } from "@/lib/fixed";
import type { LevelCheck, LevelFields } from "@/lib/level-check";
import { describeEstimate, headline, LEVELS_HELP, levelName } from "@/lib/level-words";

import { AMOUNT_INPUT } from "./amount-input";
import { Term } from "./house/Panel";

const INPUT = "mt-1 min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-base text-fg lg:min-h-0 lg:text-data focus-visible:outline-2 focus-visible:outline-glow aria-invalid:border-ember";
const FIELD: Record<LevelKind, keyof LevelFields> = { take_profit: "takeProfit", stop_loss: "stopLoss" };
const KINDS: readonly LevelKind[] = ["take_profit", "stop_loss"];

/**
 * The two fields under `title`, whose help explains how a level triggers and fills, with the check's note
 * under them. A refusal names the price it is measured from, which moves with the market, so the fields
 * describe themselves by the whole text while only its unchanging first sentence is read out as it changes.
 */
export function LevelInputs({ title, check, fields, onChange }: { title: string; check: LevelCheck; fields: LevelFields; onChange: (next: LevelFields) => void }) {
  const id = useId();
  const problems = [check.problems.take_profit, check.problems.stop_loss, check.general].filter((p) => p !== null);
  return (
    <fieldset className="mt-4">
      <legend className="text-caption text-fg-2"><Term label={title} tip={LEVELS_HELP.join(" ")} /></legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {KINDS.map((kind) => {
          const estimate = check.estimates[kind];
          return (
            <div key={kind}>
              <label htmlFor={`${id}-${kind}`} className="block text-label text-fg-3">{levelName(kind, true)}</label>
              <input {...AMOUNT_INPUT} id={`${id}-${kind}`} value={fields[FIELD[kind]]} inputMode="decimal" maxLength={24} aria-invalid={check.problems[kind] !== null} aria-describedby={`${id}-${kind}-estimate ${id}-problems`}
                onChange={(event) => onChange({ ...fields, [FIELD[kind]]: event.target.value })} className={INPUT} />
              <p id={`${id}-${kind}-estimate`} className="mt-1 text-label leading-relaxed text-fg-3">{estimate === null ? "" : describeEstimate(kind, estimate, formatUsd)}</p>
            </div>
          );
        })}
      </div>
      {check.note !== null && <p className="mt-1 text-label leading-relaxed text-fg-3">{check.note}</p>}
      <div id={`${id}-problems`} className="space-y-1 text-label leading-relaxed text-ember">
        {problems.map((p) => <p key={p} className="mt-1">{p}</p>)}
      </div>
      <p aria-live="polite" className="sr-only">{problems.map(headline).join(" ")}</p>
    </fieldset>
  );
}
