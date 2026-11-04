"use client";

/**
 * Chooses the candidate a delegation goes to: from the operator list, or, when the list in hand is
 * not the node's current one, from the last list verified or as a typed address (monkey-trading/console#279).
 * No single operator may stop a staker voting away from it, so a node that is down still leaves a way.
 */

import { useId } from "react";

import { groupThousands } from "@/lib/format";
import { offersTyped, typedAddressOk, type CandidateSource, type NoList } from "@/lib/staking/candidate-choice";
import { formatStamp } from "@/lib/time";

import { Select } from "../Select";
import { NOTE } from "../monkey/styles";

const FIELD = "min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 hover:border-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";

/** Why the list in hand is not the node's current one, as the held list's note ends. */
const WHY: Record<NoList, string> = { unverified: "the node is not verified now", unread: "the node's operator list cannot be read now" };

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
}

/** The picker: a select over the options, and, off the node's current list or while something is typed, the address field with what it is checked by. */
export function CandidatePicker({ label, options, value, onChange, source, typed, onTyped }: Props) {
  const id = useId();
  const text = typed.trim();
  const wrong = text !== "" && !typedAddressOk(text);
  return (
    <div className="space-y-2">
      {source.kind === "loading" && <p className={NOTE}>Reading the operator list…</p>}
      {options.length > 0 && <Select label={label} value={value ?? ""} options={[{ value: "", label: "Choose a candidate" }, ...options]} onChange={onChange} />}
      {source.kind === "held" && <p className={NOTE}>From the operator list last verified at {formatStamp(source.verifiedAtMs)} UTC, as the registry stood at final block {groupThousands(BigInt(source.block))}: {WHY[source.why]}.</p>}
      {offersTyped(source, typed) && (
        <>
          <label htmlFor={id} className="block text-caption text-fg-2">{options.length > 0 ? "Or a candidate's address" : "A candidate's address"}</label>
          {/* Cleared, the list's choice applies again; typed, it holds even once the node's list is back. */}
          <input id={id} value={typed} maxLength={44} spellCheck={false} autoComplete="off" placeholder="0x…" aria-invalid={wrong} aria-describedby={`${id}-note`} onChange={(event) => onTyped(event.target.value)} className={FIELD} />
          <p id={`${id}-note`} className={wrong ? "text-caption text-amber" : NOTE}>
            {wrong ? "Enter a candidate's 0x address of 40 hexadecimal digits, as its checksum has it. " : ""}An address typed here is checked only by the chain, and the staking contract takes any address: make sure it is a candidate&apos;s.
          </p>
        </>
      )}
    </div>
  );
}
