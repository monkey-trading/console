"use client";

/**
 * Chooses the candidate a delegation goes to: from the operator list, or, when the list in hand is
 * not the node's current one, as a typed address (monkey-trading/console#279, #309). No single
 * operator may stop a staker voting away from it, so a node that is down still leaves a way. Why the
 * list in hand is not the node's current one, and the last list verified, the card above the table
 * names.
 */

import { useId, useState } from "react";

import { offersTyped, typedAddressOk, type CandidateSource } from "@/lib/staking/candidate-choice";

import { Select } from "../Select";
import { NOTE } from "../monkey/styles";

const FIELD = "min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 hover:border-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";

interface Props {
  label: string;
  options: readonly { value: string; label: string }[];
  /** The chosen option; null with none to choose from. */
  value: string | null;
  onChange: (value: string) => void;
  source: CandidateSource;
  /** What is typed in the address field. */
  typed: string;
  onTyped: (text: string) => void;
  /** The editor holding this picker offers no other choice: the field stays even while cleared, so it is never hidden under the visitor's cursor. */
  keep?: boolean;
}

/** The picker: a select over the options, and, off the node's current list or while anything is typed, the address field with what it is checked by. */
export function CandidatePicker({ label, options, value, onChange, source, typed, onTyped, keep = false }: Props) {
  const id = useId();
  const text = typed.trim();
  const wrong = text !== "" && !typedAddressOk(text);
  // Clearing the last character must not hide the field under the cursor: it stays while focused,
  // and leaves once focus moves.
  const [focused, setFocused] = useState(false);
  return (
    <div className="space-y-2">
      {source.kind === "loading" && <p className={NOTE}>Reading the operator list…</p>}
      {options.length > 0 && <Select label={label} value={value ?? ""} options={[{ value: "", label: "Choose a candidate" }, ...options]} onChange={onChange} />}
      {(offersTyped(source, typed) || focused || keep) && (
        <>
          <label htmlFor={id} className="block text-caption text-fg-2">{options.length > 0 ? "Or a candidate's address" : "A candidate's address"}</label>
          {/* Cleared, the list's choice applies again; typed, it holds even once the node's list is back. */}
          <input id={id} value={typed} maxLength={44} spellCheck={false} autoComplete="off" placeholder="0x…" aria-invalid={wrong} aria-describedby={`${id}-note`} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => onTyped(event.target.value)} className={FIELD} />
          <p id={`${id}-note`} className={wrong ? "text-caption text-amber" : NOTE}>
            {wrong ? "Enter a candidate's 0x address of 40 hexadecimal digits, as its checksum has it. " : ""}An address typed here is checked only by the chain, and the staking contract takes any address: make sure it is a candidate&apos;s.
          </p>
        </>
      )}
    </div>
  );
}
