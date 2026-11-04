"use client";

/**
 * The account's delegations (monkey-trading/console#279, monkey-trading/engine#586): its stake split
 * into what each candidate holds and what abstains, read from the chain through its wallet whatever
 * the node's state, and the forms that delegate an amount of the undelegated stake, move part of a
 * delegation to another candidate, or take part of one back. Each form says what its amount would
 * change before the wallet is asked. While the node is down or unverified, Take back stays, and
 * Delegate and Move choose from the last list verified or a typed address: no single operator may
 * stop a staker voting away from it.
 */

import { useState } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { formatMonkey } from "@/lib/format";
import { changeDelegation, type DelegationChange } from "@/lib/monkey/actions";
import type { OperatorReads, OperatorsState } from "@/lib/monkey/operators";
import type { DelegationReads, DelegationsState } from "@/lib/staking/delegation-reads";
import { delegateWords, moveWords, takeBackWords } from "@/lib/staking/delegation-words";
import { delegationTo, undelegatedOf } from "@/lib/staking/delegations";

import { AmountForm } from "../monkey/AmountForm";
import { focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { Row } from "../monkey/Row";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "../monkey/use-monkey";
import { CandidatePicker, pickedCandidate, type CandidateSource } from "./CandidatePicker";

/** The Delegate form's box, whose amount field a table row's Delegate button focuses. */
export const DELEGATE_FORM_ID = "delegate-form";

const TOGGLE = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 lg:min-h-0";

interface Props {
  operators: OperatorReads;
  /** The operator reads' state: the node's current list and the last one verified. */
  lists: Pick<OperatorsState, "list" | "held">;
  delegations: DelegationReads;
  /** The chain's word on the account's stake and delegations. */
  read: DelegationsState;
  /** The candidate the Delegate form sends to, which the table's Delegate buttons set. */
  target: string | null;
  onTarget: (candidate: string) => void;
  labelOf: (address: string) => string;
  /** The heading the page returns focus to once a change has landed. */
  titleId: string;
}

/**
 * The delegations block of the operators card. Until the wallet's read lands it holds its loaded
 * layout, with dashes and a closed Delegate form, so the table below does not move when it does.
 */
export function Delegations({ operators, lists, delegations: reads, read, target, onTarget, labelOf, titleId }: Props) {
  const panel = useMonkeyPanel();
  const { settling } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const decided = useConsoleSelect((state) => state.walletDecided);
  const busy = useConsoleSelect((state) => state.busy);
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const [editing, setEditing] = useState<{ candidate: string; mode: "move" | "undelegate" } | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [typedTo, setTypedTo] = useState("");
  const [typedMove, setTypedMove] = useState("");
  const mine = wallet !== null && read.account === wallet.address;
  const held = mine ? read.read.value : null;
  // The node's current list while it is trusted; else the last one verified; else none, and a typed address.
  const current = trusted && lists.list.value !== null ? lists.list.value : null;
  const source: CandidateSource = current !== null ? { kind: "current" } : lists.held !== null ? { kind: "held", verifiedAtMs: lists.held.verifiedAtMs, block: lists.held.view.block.number } : { kind: "none" };
  const listed = (current ?? lists.held?.view ?? null)?.rows.filter((row) => row.listed) ?? [];
  const options = listed.map((row) => ({ value: row.address, label: labelOf(row.address) }));
  const disabled = busy || settling || held === null;
  /** Opens one delegation's form, or closes it; an amount or address typed under another delegation is not this one's. */
  const edit = (next: { candidate: string; mode: "move" | "undelegate" } | null) => {
    if (next?.candidate !== editing?.candidate) {
      panel.setDraft("move", "");
      panel.setDraft("undelegate", "");
      setTypedMove("");
    }
    setEditing(next);
  };
  const send = (next: DelegationChange, onLanded: () => void) =>
    changeDelegation(panel, operators, reads, next, onLanded).then((landed) => {
      if (landed) {
        setEditing(null);
        focusHeading(titleId);
      }
    });
  if (wallet === null && decided) return <p className={NOTE}>Connect a wallet to delegate your stake.</p>;
  if (wallet?.readOnly === true) return <p className={NOTE}>This account is read-only, so its delegations are not read and nothing can be delegated for it.</p>;
  const staked = held?.staked ?? null;
  const delegated = held?.delegations ?? [];
  const undelegated = held === null ? 0n : undelegatedOf(held.staked, delegated);
  const chosen = target !== null && listed.some((row) => row.address === target) ? target : (listed[0]?.address ?? null);
  const to = pickedCandidate(source, typedTo, chosen);
  return (
    <div className="space-y-3">
      <dl className="space-y-2">
        <Row label="Staked">{staked === null ? "—" : formatMonkey(staked)}</Row>
        <Row label="Delegated">{held === null ? "—" : formatMonkey(held.delegated)}</Row>
        <Row label="Undelegated">{held === null ? "—" : formatMonkey(undelegated)}</Row>
      </dl>
      {/* The dashes already hold the block's shape, so the pending line is for screen readers alone. */}
      <ReadNote read={mine ? read.read : { status: "loading", value: null, message: null }} loading="Reading your delegations from the chain…" quiet />
      <div id={DELEGATE_FORM_ID} className="space-y-2 rounded border border-line-2 p-3">
        <CandidatePicker label="Delegate to" options={options} value={chosen} onChange={onTarget} source={source} typed={typedTo} onTyped={setTypedTo} />
        <AmountForm
          field="delegate" label="Amount to delegate" action="Delegate" max={undelegated} maxLabel="your undelegated stake" disabled={disabled || to === null}
          onSubmit={(amount, onLanded) => (to === null ? Promise.resolve() : send({ kind: "delegate", to, toLabel: labelOf(to), amount }, onLanded))}
          preview={(amount) => (to === null ? null : delegateWords(undelegated, delegationTo(delegated, to), amount, labelOf(to)))}
        />
      </div>
      {held === null ? null : delegated.length === 0 ? (
        <p className={NOTE}>You delegate none of your stake, so all of it abstains.</p>
      ) : (
        <ul className="space-y-2" aria-label="Your delegations">
          {delegated.map(({ candidate, amount }) => {
            const label = labelOf(candidate);
            const open = editing?.candidate === candidate ? editing.mode : null;
            const targets = options.filter((option) => option.value !== candidate);
            const listedTo = moveTo !== null && targets.some((option) => option.value === moveTo) ? moveTo : (targets[0]?.value ?? null);
            const movesTo = pickedCandidate(source, typedMove, listedTo);
            const canMove = targets.length > 0 || source.kind !== "current";
            return (
              <li key={candidate} className="space-y-2 rounded border border-line-2 p-3 text-caption">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-fg"><span title={candidate}>{label}</span>: {formatMonkey(amount)}</p>
                  <div className="flex gap-2">
                    <button type="button" aria-expanded={open === "move"} aria-disabled={!canMove} onClick={() => { if (canMove) edit(open === "move" ? null : { candidate, mode: "move" }); }} className={TOGGLE}>Move<span className="sr-only"> part of your delegation to {label}</span></button>
                    <button type="button" aria-expanded={open === "undelegate"} onClick={() => edit(open === "undelegate" ? null : { candidate, mode: "undelegate" })} className={TOGGLE}>Take back<span className="sr-only"> part of your delegation to {label}</span></button>
                  </div>
                </div>
                {open === "move" && (
                  <>
                    <CandidatePicker label="Move to" options={targets} value={listedTo} onChange={setMoveTo} source={source} typed={typedMove} onTyped={setTypedMove} />
                    <AmountForm
                      field="move" label="Amount to move" action="Move" max={amount} maxLabel={`your delegation to ${label}`} disabled={disabled || movesTo === null || movesTo === candidate}
                      onSubmit={(sent, onLanded) => (movesTo === null ? Promise.resolve() : send({ kind: "redelegate", from: candidate, fromLabel: label, to: movesTo, toLabel: labelOf(movesTo), amount: sent }, onLanded))}
                      preview={(sent) => (movesTo === null || movesTo === candidate ? null : moveWords({ label, held: amount }, { label: labelOf(movesTo), held: delegationTo(delegated, movesTo) }, sent, undelegated))}
                    />
                  </>
                )}
                {open === "undelegate" && (
                  <AmountForm
                    field="undelegate" label="Amount to take back" action="Take back" max={amount} maxLabel={`your delegation to ${label}`} disabled={disabled}
                    onSubmit={(sent, onLanded) => send({ kind: "undelegate", from: candidate, fromLabel: label, amount: sent }, onLanded)}
                    preview={(sent) => takeBackWords(amount, undelegated, sent, label)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
