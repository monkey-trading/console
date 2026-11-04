"use client";

/**
 * The account's delegations (monkey-trading/console#279, monkey-trading/engine#586): its stake split
 * into what each candidate holds and what abstains, read from the wallet's `delegationsOf`, and the
 * forms that delegate an amount of the undelegated stake, move part of a delegation to another
 * candidate, or take part of one back. Each form says what its amount would change before the wallet
 * is asked; the figures follow the chain by themselves after each transaction.
 */

import { useState } from "react";

import { formatMonkey } from "@/lib/format";
import { changeDelegation, type DelegationChange } from "@/lib/monkey/actions";
import type { OperatorReads } from "@/lib/monkey/operators";
import { delegatedOf, delegationTo, undelegatedOf } from "@/lib/staking/delegations";
import type { OperatorRow } from "@/lib/staking/operator-table";

import { Select } from "../Select";
import { AmountForm } from "../monkey/AmountForm";
import { focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { Row } from "../monkey/Row";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "../monkey/use-monkey";

const TOGGLE = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 lg:min-h-0";

/** `before → after` in MONKEY. */
const change = (before: bigint, after: bigint) => `${formatMonkey(before)} → ${formatMonkey(after)}`;

interface Props {
  operators: OperatorReads;
  /** The candidates the list holds, for the forms' choices and each candidate's votes. */
  rows: readonly OperatorRow[];
  /** The candidate the Delegate form sends to, which the table's Delegate buttons set. */
  target: string | null;
  onTarget: (candidate: string) => void;
  labelOf: (address: string) => string;
  /** The heading the page returns focus to once a change has landed. */
  titleId: string;
}

export function Delegations({ operators, rows, target, onTarget, labelOf, titleId }: Props) {
  const panel = useMonkeyPanel();
  const { wallet: figures, settling } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  const [editing, setEditing] = useState<{ candidate: string; mode: "move" | "undelegate" } | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const mine = wallet !== null && figures.address === wallet.address;
  const position = mine ? figures.position.value : null;
  const listed = rows.filter((row) => row.listed);
  const votesOf = (candidate: string) => rows.find((row) => row.address === candidate)?.votes ?? null;
  const options = listed.map((row) => ({ value: row.address, label: labelOf(row.address) }));
  const disabled = busy || settling || position === null;
  const send = (next: DelegationChange, onLanded: () => void) =>
    changeDelegation(panel, operators, next, onLanded).then((landed) => {
      if (landed) {
        setEditing(null);
        focusHeading(titleId);
      }
    });
  if (wallet === null) return <p className={NOTE}>Connect a wallet to delegate your stake.</p>;
  if (wallet.readOnly === true) return <p className={NOTE}>This account is read-only, so its delegations are not read and nothing can be delegated for it.</p>;
  if (position === null) return <ReadNote read={figures.position} loading="Reading your delegations…" />;
  const { staked, delegations } = position;
  const undelegated = undelegatedOf(staked, delegations);
  const chosen = target !== null && listed.some((row) => row.address === target) ? target : (listed[0]?.address ?? null);
  return (
    <div className="space-y-3">
      <dl className="space-y-2">
        <Row label="Staked">{formatMonkey(staked)}</Row>
        <Row label="Delegated">{formatMonkey(delegatedOf(delegations))}</Row>
        <Row label="Undelegated">{formatMonkey(undelegated)}</Row>
      </dl>
      <ReadNote read={figures.position} />
      {chosen !== null && (
        <div className="space-y-2 rounded border border-line-2 p-3">
          <Select label="Delegate to" value={chosen} options={options} onChange={onTarget} />
          <AmountForm
            field="delegate" label="Amount to delegate" action="Delegate" max={undelegated} maxLabel="your undelegated stake" disabled={disabled}
            onSubmit={(amount, onLanded) => send({ kind: "delegate", to: chosen, toLabel: labelOf(chosen), amount }, onLanded)}
            preview={(amount) => {
              const held = delegationTo(delegations, chosen);
              const votes = votesOf(chosen);
              return `Undelegated ${change(undelegated, undelegated - amount)}. Your delegation to ${labelOf(chosen)} ${change(held, held + amount)}${votes === null ? "" : `, and its votes ${change(votes, votes + amount)}`}.`;
            }}
          />
        </div>
      )}
      {delegations.length === 0 ? (
        <p className={NOTE}>You delegate none of your stake, so all of it abstains.</p>
      ) : (
        <ul className="space-y-2" aria-label="Your delegations">
          {delegations.map(({ candidate, amount }) => {
            const label = labelOf(candidate);
            const open = editing?.candidate === candidate ? editing.mode : null;
            const targets = options.filter((option) => option.value !== candidate);
            const to = moveTo !== null && targets.some((option) => option.value === moveTo) ? moveTo : (targets[0]?.value ?? null);
            return (
              <li key={candidate} className="space-y-2 rounded border border-line-2 p-3 text-caption">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-fg"><span title={candidate}>{label}</span>: {formatMonkey(amount)}</p>
                  <div className="flex gap-2">
                    <button type="button" aria-expanded={open === "move"} aria-disabled={targets.length === 0} onClick={() => { if (targets.length > 0) setEditing(open === "move" ? null : { candidate, mode: "move" }); }} className={TOGGLE}>Move<span className="sr-only"> part of your delegation to {label}</span></button>
                    <button type="button" aria-expanded={open === "undelegate"} onClick={() => setEditing(open === "undelegate" ? null : { candidate, mode: "undelegate" })} className={TOGGLE}>Take back<span className="sr-only"> part of your delegation to {label}</span></button>
                  </div>
                </div>
                {open === "move" && to !== null && (
                  <>
                    <Select label="Move to" value={to} options={targets} onChange={setMoveTo} />
                    <AmountForm
                      field="move" label="Amount to move" action="Move" max={amount} maxLabel={`your delegation to ${label}`} disabled={disabled}
                      onSubmit={(sent, onLanded) => send({ kind: "redelegate", from: candidate, fromLabel: label, to, toLabel: labelOf(to), amount: sent }, onLanded)}
                      preview={(sent) => {
                        const there = delegationTo(delegations, to);
                        return `Your delegation to ${label} ${change(amount, amount - sent)}, and to ${labelOf(to)} ${change(there, there + sent)}. Your undelegated stake stays ${formatMonkey(undelegated)}.`;
                      }}
                    />
                  </>
                )}
                {open === "undelegate" && (
                  <AmountForm
                    field="undelegate" label="Amount to take back" action="Take back" max={amount} maxLabel={`your delegation to ${label}`} disabled={disabled}
                    onSubmit={(sent, onLanded) => send({ kind: "undelegate", from: candidate, fromLabel: label, amount: sent }, onLanded)}
                    preview={(sent) => `Your delegation to ${label} ${change(amount, amount - sent)}. Undelegated ${change(undelegated, undelegated + sent)}.`}
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
