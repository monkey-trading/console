"use client";

/**
 * The editor a Delegate tab row's button opens under its row (monkey-trading/console#309): the
 * amount, and, for a Move, the destination, with what the amount would change said before the wallet
 * is asked. The "Delegate to an address" editor (candidate `TYPED_EDITOR`) takes a typed address the
 * chain alone checks, refused when it is malformed, fails its checksum or is the zero address.
 */

import type { StakeDelegations } from "@/lib/engine/staking";
import type { DelegationChange } from "@/lib/monkey/actions";
import { pickedCandidate, type CandidateSource } from "@/lib/staking/candidate-choice";
import {
  amountKey,
  clearAmount,
  setAmount,
  setMoveTo,
  setTypedMove,
  setTypedTo,
  TYPED_EDITOR,
  type DelegateEditing,
  type EditorMode,
} from "@/lib/staking/delegation-form";
import { delegateWords, moveWords, takeBackWords } from "@/lib/staking/delegation-words";
import { delegationTo, undelegatedOf } from "@/lib/staking/delegations";

import { AmountForm, type AmountDraft } from "../monkey/AmountForm";
import { CandidatePicker } from "./CandidatePicker";

interface Props {
  mode: EditorMode;
  /** The row's candidate, or TYPED_EDITOR for the "Delegate to an address" editor. */
  candidate: string;
  /** How the page names the row's candidate. */
  label: string;
  /** The chain's word on the account's stake: what bounds an amount and what a preview starts from. */
  chain: StakeDelegations;
  /** The listed candidates a Move may choose, already without this row. */
  options: readonly { value: string; label: string }[];
  source: CandidateSource;
  /** The Delegate tab's editing context, which keeps what this editor holds across a tab switch. */
  editing: DelegateEditing;
  onEdit: (next: DelegateEditing) => void;
  disabled: boolean;
  /** How a typed address is named once it resolves. */
  nameOf: (address: string) => string;
  send: (change: DelegationChange, onLanded: () => void) => Promise<unknown>;
}

/** The Delegate tab's per-row editor; the words of each preview are `delegation-words.ts`. */
export function DelegationEditor({ mode, candidate, label, chain, options, source, editing, onEdit, disabled, nameOf, send }: Props) {
  const key = amountKey(mode, candidate);
  const draft: AmountDraft = {
    text: editing.amounts[key] ?? "",
    set: (text) => onEdit(setAmount(editing, key, text)),
    clear: (sent) => onEdit(clearAmount(editing, key, sent)),
  };
  const delegated = chain.delegations;
  const undelegated = undelegatedOf(chain.staked, delegated);
  if (mode === "delegate" && candidate === TYPED_EDITOR) {
    const to = pickedCandidate(editing.typedTo, null);
    return (
      <div className="space-y-2">
        <CandidatePicker label="A candidate's address" options={[]} value={null} onChange={() => undefined} source={source} typed={editing.typedTo} onTyped={(text) => onEdit(setTypedTo(editing, text))} />
        <AmountForm
          draft={draft} label="Amount to delegate" action="Delegate" max={undelegated} maxLabel="your undelegated stake" disabled={disabled || to === null}
          onSubmit={(amount, onLanded) => (to === null ? Promise.resolve() : send({ kind: "delegate", to, toLabel: nameOf(to), amount }, onLanded))}
          preview={(amount) => (to === null ? null : delegateWords(undelegated, delegationTo(delegated, to), amount, nameOf(to)))}
        />
      </div>
    );
  }
  if (mode === "delegate") {
    return (
      <AmountForm
        draft={draft} label="Amount to delegate" action="Delegate" max={undelegated} maxLabel="your undelegated stake" disabled={disabled}
        onSubmit={(amount, onLanded) => send({ kind: "delegate", to: candidate, toLabel: label, amount }, onLanded)}
        preview={(amount) => delegateWords(undelegated, delegationTo(delegated, candidate), amount, label)}
      />
    );
  }
  if (mode === "move") {
    const held = delegationTo(delegated, candidate);
    const listedTo = editing.moveTo !== "" && options.some((option) => option.value === editing.moveTo) ? editing.moveTo : "";
    const movesTo = pickedCandidate(editing.typedMove, listedTo === "" ? null : listedTo);
    return (
      <div className="space-y-2">
        <CandidatePicker label="Move to" options={options} value={listedTo === "" ? null : listedTo} onChange={(next) => onEdit(setMoveTo(editing, next))} source={source} typed={editing.typedMove} onTyped={(text) => onEdit(setTypedMove(editing, text))} />
        <AmountForm
          draft={draft} label="Amount to move" action="Move" max={held} maxLabel={`your delegation to ${label}`} disabled={disabled || movesTo === null || movesTo === candidate}
          onSubmit={(amount, onLanded) => (movesTo === null ? Promise.resolve() : send({ kind: "redelegate", from: candidate, fromLabel: label, to: movesTo, toLabel: nameOf(movesTo), amount }, onLanded))}
          preview={(amount) => (movesTo === null || movesTo === candidate ? null : moveWords({ label, held }, { label: nameOf(movesTo), held: delegationTo(delegated, movesTo) }, amount, undelegated))}
        />
      </div>
    );
  }
  const held = delegationTo(delegated, candidate);
  return (
    <AmountForm
      draft={draft} label="Amount to take back" action="Take back" max={held} maxLabel={`your delegation to ${label}`} disabled={disabled}
      onSubmit={(amount, onLanded) => send({ kind: "undelegate", from: candidate, fromLabel: label, amount }, onLanded)}
      preview={(amount) => takeBackWords(held, undelegated, amount, label)}
    />
  );
}
