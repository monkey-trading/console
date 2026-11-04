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

import { formatMonkey } from "@/lib/format";
import { changeDelegation, type DelegationChange } from "@/lib/monkey/actions";
import type { OperatorReads, OperatorsState } from "@/lib/monkey/operators";
import { candidateSource, nodeBlocked, pickedCandidate } from "@/lib/staking/candidate-choice";
import { CLOSED_FORM, openForm, type DelegationForm } from "@/lib/staking/delegation-form";
import type { DelegationReads, DelegationsState } from "@/lib/staking/delegation-reads";
import { delegateWords, moveWords, takeBackWords } from "@/lib/staking/delegation-words";
import { delegationTo, undelegatedOf } from "@/lib/staking/delegations";
import { withAddress } from "@/lib/staking/operator-cells";

import { AmountForm } from "../monkey/AmountForm";
import { focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { Row } from "../monkey/Row";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect, useMonkeyPanel } from "../monkey/use-monkey";
import { CandidatePicker } from "./CandidatePicker";

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
  /** The candidate the Delegate form sends to, "" for none chosen yet, which the table's Delegate buttons set, and the address typed there instead. */
  target: string;
  onTarget: (candidate: string) => void;
  typedTo: string;
  onTypedTo: (text: string) => void;
  labelOf: (address: string) => string;
  /** The heading the page returns focus to once a change has landed. */
  titleId: string;
}

/**
 * The delegations block of the operators card. Until the wallet's read lands it holds its loaded
 * layout, with dashes and a closed Delegate form, so the table below does not move when it does.
 */
export function Delegations({ operators, lists, delegations: reads, read, target, onTarget, typedTo, onTypedTo, labelOf, titleId }: Props) {
  const panel = useMonkeyPanel();
  const wallet = useConsoleSelect((state) => state.wallet);
  const decided = useConsoleSelect((state) => state.walletDecided);
  const busy = useConsoleSelect((state) => state.busy);
  // The operator reads' own rule for whether the node's answers may be read, so the forms and the list agree.
  const blocked = useConsoleSelect((state) => nodeBlocked(state.attestation));
  const [form, setForm] = useState<DelegationForm>(CLOSED_FORM);
  const { editing, moveTo, typedMove } = form;
  const mine = wallet !== null && read.account === wallet.address;
  // The chain's word on this account's stake and delegations.
  const chain = mine ? read.read.value : null;
  // The node's current list while it is read; else the last one verified; else none, and a typed address.
  const source = candidateSource(lists.list, lists.held, blocked);
  const view = source.kind === "current" ? lists.list.value : source.kind === "held" ? (lists.held?.view ?? null) : null;
  const listed = view?.rows.filter((row) => row.listed) ?? [];
  const nameOf = (address: string) => withAddress(labelOf(address), address);
  const options = listed.map((row) => ({ value: row.address, label: nameOf(row.address) }));
  // Shut until a read begun after the last landed transaction succeeds: the figures held are the ones before it.
  // The chain's read alone decides, never the node's: no operator may hold a staker's vote in place.
  const disabled = busy || read.settling || chain === null;
  /** Opens one delegation's form, or closes it; an amount, address or destination chosen under another delegation is not this one's. */
  const edit = (next: DelegationForm["editing"]) => {
    const opened = openForm(form, next);
    if (opened.fresh) {
      panel.setDraft("move", "");
      panel.setDraft("undelegate", "");
    }
    setForm(opened.form);
  };
  const send = (next: DelegationChange, onLanded: () => void) =>
    changeDelegation(panel, operators, reads, next, onLanded).then((landed) => {
      if (landed) {
        setForm((now) => ({ ...now, editing: null }));
        focusHeading(titleId);
      }
    });
  if (wallet === null && decided) return <p className={NOTE}>Connect a wallet to delegate your stake.</p>;
  if (wallet?.readOnly === true) return <p className={NOTE}>This account is read-only, so its delegations are not read and nothing can be delegated for it.</p>;
  if (mine && read.read.status === "unavailable") return <p className={NOTE}>This build names no staking contract, so delegation is not available here.</p>;
  const staked = chain?.staked ?? null;
  const delegated = chain?.delegations ?? [];
  const undelegated = chain === null ? 0n : undelegatedOf(chain.staked, delegated);
  // No candidate is chosen for the visitor: the form waits for a choice in the list, a table row or a typed address.
  const chosen = listed.some((row) => row.address === target) ? target : "";
  const to = pickedCandidate(typedTo, chosen);
  return (
    <div className="space-y-3">
      <dl className="space-y-2">
        <Row label="Staked">{staked === null ? "—" : formatMonkey(staked)}</Row>
        <Row label="Delegated">{chain === null ? "—" : formatMonkey(chain.delegated)}</Row>
        <Row label="Undelegated">{chain === null ? "—" : formatMonkey(undelegated)}</Row>
      </dl>
      {/* The dashes already hold the block's shape, so the pending line is for screen readers alone. */}
      <ReadNote read={mine ? read.read : { status: "loading", value: null, message: null }} loading="Reading your delegations from the chain…" quiet />
      <div id={DELEGATE_FORM_ID} className="space-y-2 rounded border border-line-2 p-3">
        <CandidatePicker label="Delegate to" options={options} value={chosen} onChange={(candidate) => { onTarget(candidate); onTypedTo(""); }} source={source} typed={typedTo} onTyped={onTypedTo} />
        <AmountForm
          field="delegate" label="Amount to delegate" action="Delegate" max={undelegated} maxLabel="your undelegated stake" disabled={disabled || to === null}
          onSubmit={(amount, onLanded) => (to === null ? Promise.resolve() : send({ kind: "delegate", to, toLabel: nameOf(to), amount }, onLanded))}
          preview={(amount) => (to === null ? null : delegateWords(undelegated, delegationTo(delegated, to), amount, nameOf(to)))}
        />
      </div>
      {/* Until the read lands, the line it will most often show holds its place, unseen. */}
      {chain === null ? <p aria-hidden="true" className={`${NOTE} invisible`}>You delegate none of your stake, so all of it abstains.</p> : delegated.length === 0 ? (
        <p className={NOTE}>You delegate none of your stake, so all of it abstains.</p>
      ) : (
        <ul className="space-y-2" aria-label="Your delegations">
          {delegated.map(({ candidate, amount }) => {
            const label = nameOf(candidate);
            const open = editing?.candidate === candidate ? editing.mode : null;
            const targets = options.filter((option) => option.value !== candidate);
            const listedTo = moveTo !== null && targets.some((option) => option.value === moveTo) ? moveTo : "";
            const movesTo = pickedCandidate(typedMove, listedTo);
            const canMove = targets.length > 0 || source.kind === "held" || source.kind === "none";
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
                    <CandidatePicker label="Move to" options={targets} value={listedTo} onChange={(candidate) => setForm({ ...form, moveTo: candidate, typedMove: "" })} source={source} typed={typedMove} onTyped={(text) => setForm({ ...form, typedMove: text })} />
                    <AmountForm
                      field="move" label="Amount to move" action="Move" max={amount} maxLabel={`your delegation to ${label}`} disabled={disabled || movesTo === null || movesTo === candidate}
                      onSubmit={(sent, onLanded) => (movesTo === null ? Promise.resolve() : send({ kind: "redelegate", from: candidate, fromLabel: label, to: movesTo, toLabel: nameOf(movesTo), amount: sent }, onLanded))}
                      preview={(sent) => (movesTo === null || movesTo === candidate ? null : moveWords({ label, held: amount }, { label: nameOf(movesTo), held: delegationTo(delegated, movesTo) }, sent, undelegated))}
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
