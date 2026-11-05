"use client";

/**
 * One page of the operator table (monkey-trading/console#279, #309): a card per operator below
 * 1024 px and a table from there, each with its role, delegated stake, self-bond, release and
 * handover endpoint, and what the account delegates to it. Delegate, Move and Take back are actions
 * on each row; each opens its editor under the row — one editor at a time — saying what its amount
 * would change before the wallet is asked. Every string from the list renders as text.
 */

import { Fragment, useId } from "react";

import type { StakeDelegations } from "@/lib/engine/staking";
import { formatMonkey } from "@/lib/format";
import type { DelegationChange } from "@/lib/monkey/actions";
import type { CandidateSource } from "@/lib/staking/candidate-choice";
import { openRowEditor, type DelegateEditing, type EditorMode } from "@/lib/staking/delegation-form";
import { operatorCells, type OperatorCells } from "@/lib/staking/operator-cells";
import { ariaSort, type OperatorRow, type SortId } from "@/lib/staking/operator-table";

import { DelegationEditor } from "./DelegationEditor";

interface Props {
  rows: readonly OperatorRow[];
  sort: SortId;
  /** What the account delegates to each candidate, zero for none. */
  held: (address: string) => bigint;
  /** The chain's word on the account's stake; it bounds the editors' amounts and feeds their previews. */
  chain: StakeDelegations | null;
  canVote: boolean;
  disabled: boolean;
  /** Whether this build could connect to the hostname a listed candidate registered. */
  reachable: (row: OperatorRow) => boolean;
  /** Every listed candidate, for the destinations a Move form offers. */
  listed: readonly OperatorRow[];
  source: CandidateSource;
  /** The Delegate tab's editing context: which editor is open and what it holds. */
  editing: DelegateEditing;
  onEdit: (next: DelegateEditing) => void;
  nameOf: (address: string) => string;
  send: (change: DelegationChange, onLanded: () => void) => Promise<unknown>;
}

const TH = "px-3 py-2 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-3 py-2 align-top";
const TOGGLE = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 aria-disabled:hover:border-line-2 lg:min-h-0";
const ROLE_TONE: Record<OperatorRow["role"], string> = {
  active: "border-glow/40 text-glow",
  elected: "border-amber/40 text-amber",
  promoted: "border-amber/40 text-amber",
  standby: "border-line-2 text-fg",
  candidate: "border-line-2 text-fg-2",
};

/** The row's role and whether it would count in an election close now. */
function Role({ row }: { row: OperatorRow }) {
  const cells = operatorCells(row);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-block rounded border px-1 text-label uppercase ${ROLE_TONE[row.role]}`}>{cells.role}</span>
      <span className={`text-label ${row.listed && row.eligible ? "text-fg-2" : "text-fg-3"}`}>{cells.eligibility}</span>
    </span>
  );
}

/** The row's hostname and address, and a mark where this build could not connect to it. */
function Name({ row, cells, reachable }: { row: OperatorRow; cells: OperatorCells; reachable: boolean }) {
  return (
    <>
      <span className={`block break-all ${row.hostname === null ? "text-fg-3" : "text-fg"}`}>{cells.name}</span>
      <span className="block text-label text-fg-3" title={row.address}>{cells.address}</span>
      {row.listed && !reachable && <span className="mt-1 block text-label text-amber">Not in this build</span>}
    </>
  );
}

/**
 * The row's actions: Delegate on a listed row, Move and Take back on one the account delegates to —
 * each named from its visible word, each opening its editor under the row. Nothing shows for a
 * visitor who cannot vote.
 */
function Actions({ row, label, held, listed, source, editing, onEdit, disabled, canVote, editorId }: Pick<Props, "held" | "listed" | "source" | "editing" | "onEdit" | "disabled" | "canVote"> & { row: OperatorRow; label: string; editorId: (mode: EditorMode) => string }) {
  const mine = held(row.address);
  const open = editing.editing?.candidate === row.address ? editing.editing.mode : null;
  const toggle = (mode: EditorMode) => onEdit(openRowEditor(editing, open === mode ? null : { candidate: row.address, mode }));
  if (!canVote || (!row.listed && mine === 0n)) return null;
  const canMove = listed.some((candidate) => candidate.address !== row.address) || source.kind === "held" || source.kind === "none";
  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      {row.listed && (
        <button type="button" aria-expanded={open === "delegate"} aria-controls={editorId("delegate")} aria-disabled={disabled} onClick={() => { if (!disabled) toggle("delegate"); }} className={TOGGLE}>
          Delegate<span className="sr-only"> to {label}</span>
        </button>
      )}
      {mine > 0n && (
        <>
          <button type="button" aria-expanded={open === "move"} aria-controls={editorId("move")} aria-disabled={disabled || !canMove} onClick={() => { if (!disabled && canMove) toggle("move"); }} className={TOGGLE}>
            Move<span className="sr-only"> part of your delegation to {label}</span>
          </button>
          <button type="button" aria-expanded={open === "undelegate"} aria-controls={editorId("undelegate")} onClick={() => toggle("undelegate")} className={TOGGLE}>
            Take back<span className="sr-only"> part of your delegation to {label}</span>
          </button>
        </>
      )}
    </div>
  );
}

/** The editor open under `row`, or null with none open; its id is the row's button `aria-controls` names. */
function editorFor(idPrefix: string, row: OperatorRow, props: Props) {
  const { chain, editing, onEdit, disabled, listed, source, nameOf, send } = props;
  const open = editing.editing?.candidate === row.address ? editing.editing.mode : null;
  if (open === null || chain === null) return null;
  const options = listed.filter((candidate) => candidate.address !== row.address).map((candidate) => ({ value: candidate.address, label: nameOf(candidate.address) }));
  return (
    <div id={`${idPrefix}-${open}`} className="space-y-2 rounded border border-line-2 p-3">
      <DelegationEditor mode={open} candidate={row.address} label={nameOf(row.address)} chain={chain} options={options} source={source} editing={editing} onEdit={onEdit} disabled={disabled} nameOf={nameOf} send={send} />
    </div>
  );
}

/** One page of rows, both layouts; the one the width does not use is hidden from everyone. */
export function OperatorTable(props: Props) {
  const { rows, sort, held, reachable } = props;
  const cardsId = useId();
  const tableId = useId();
  return (
    <>
      <ul className="space-y-2 lg:hidden" aria-label="Operators">
        {rows.map((row) => {
          const cells = operatorCells(row);
          const mine = held(row.address);
          const editorId = (mode: EditorMode) => `${cardsId}-${row.address}-${mode}`;
          return (
            <li key={row.address} className={`space-y-2 rounded border p-3 text-caption ${mine > 0n ? "border-glow" : "border-line-2"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><Name row={row} cells={cells} reachable={reachable(row)} /></div>
                <Role row={row} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-fg-2">
                <div><dt className="text-label text-fg-3">Delegated stake</dt><dd>{cells.delegated}</dd></div>
                <div><dt className="text-label text-fg-3">Self-bond</dt><dd>{cells.bond}</dd></div>
                <div><dt className="text-label text-fg-3">Release</dt><dd title={row.release}>{cells.release}</dd></div>
                <div className="col-span-2"><dt className="text-label text-fg-3">Handover endpoint</dt><dd className="[overflow-wrap:anywhere]">{cells.endpoint}</dd></div>
                <div><dt className="text-label text-fg-3">Yours</dt><dd className={mine > 0n ? "text-glow" : ""}>{mine > 0n ? formatMonkey(mine) : "—"}</dd></div>
              </dl>
              <Actions {...props} row={row} label={props.nameOf(row.address)} editorId={editorId} />
              {editorFor(`${cardsId}-${row.address}`, row, props)}
            </li>
          );
        })}
      </ul>
      <div role="region" aria-label="Operators table" tabIndex={0} className="hidden overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:block">
        <table className="w-full min-w-[62rem] text-caption">
          <caption className="sr-only">Operators the registry lists, with each one&apos;s role, delegated stake and share of all stake, self-bond, release and handover endpoint, and what you delegate to it. Amounts are in MONKEY.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" aria-sort={ariaSort("name", sort)} className={TH}>Operator</th>
              <th scope="col" aria-sort={ariaSort("role", sort)} className={TH}>Role</th>
              <th scope="col" aria-sort={ariaSort("votes", sort)} className={TH}>Delegated stake</th>
              <th scope="col" aria-sort={ariaSort("bond", sort)} className={TH}>Self-bond</th>
              <th scope="col" className={TH}>Release</th>
              <th scope="col" className={TH}>Handover endpoint</th>
              <th scope="col" className={TH}>Yours</th>
              <th scope="col" className={TH}><span className="sr-only">Delegate, move and take back</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cells = operatorCells(row);
              const mine = held(row.address);
              const editorId = (mode: EditorMode) => `${tableId}-${row.address}-${mode}`;
              const editor = editorFor(`${tableId}-${row.address}`, row, props);
              return (
                <Fragment key={row.address}>
                  <tr className={`border-b border-line ${mine > 0n ? "bg-glow/5" : ""}`}>
                    <td className={`${TD} max-w-[16rem]`}><Name row={row} cells={cells} reachable={reachable(row)} /></td>
                    <td className={TD}><Role row={row} /></td>
                    <td className={`${TD} whitespace-nowrap text-fg`}>{cells.delegated}</td>
                    <td className={`${TD} whitespace-nowrap text-fg-2`}>{cells.bond}</td>
                    <td className={`${TD} whitespace-nowrap text-fg-2`} title={row.release}>{cells.release}</td>
                    <td className={`${TD} text-fg-2 [overflow-wrap:anywhere]`}>{cells.endpoint}</td>
                    <td className={`${TD} whitespace-nowrap ${mine > 0n ? "text-glow" : "text-fg-2"}`}>{mine > 0n ? formatMonkey(mine) : "—"}</td>
                    <td className={TD}><Actions {...props} row={row} label={props.nameOf(row.address)} editorId={editorId} /></td>
                  </tr>
                  {editor !== null && (
                    <tr className="border-b border-line last:border-b-0">
                      <td colSpan={8} className="px-3 pb-3">{editor}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
