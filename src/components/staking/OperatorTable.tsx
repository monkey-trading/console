"use client";

/**
 * One page of the operator table: a card per operator below 1024 px and a table from there, each with
 * its role, delegated stake, self-bond, release and handover endpoint, what the account delegates to
 * it, and the button that chooses it in the Delegate form. Every string from the list renders as text.
 */

import { formatMonkey } from "@/lib/format";
import { operatorCells } from "@/lib/staking/operator-cells";
import { ariaSort, type OperatorRow, type SortId } from "@/lib/staking/operator-table";

import { BUTTON } from "../monkey/styles";

interface Props {
  rows: readonly OperatorRow[];
  sort: SortId;
  /** What the account delegates to each candidate, zero for none. */
  held: (address: string) => bigint;
  canVote: boolean;
  disabled: boolean;
  /** Whether this build could connect to the hostname a listed candidate registered. */
  reachable: (row: OperatorRow) => boolean;
  onDelegate: (row: OperatorRow) => void;
}

const TH = "px-3 py-2 text-left text-label font-normal tracking-caps text-fg-3 uppercase";
const TD = "px-3 py-2 align-top";
const ROLE_TONE: Record<OperatorRow["role"], string> = {
  active: "border-glow/40 text-glow",
  elected: "border-amber/40 text-amber",
  promoted: "border-amber/40 text-amber",
  standby: "border-line-2 text-fg",
  candidate: "border-line-2 text-fg-2",
};

/** What the account delegates to the row, and the Delegate button that chooses it in the form above the table. */
function Action({ row, label, held, canVote, disabled, onDelegate }: Pick<Props, "held" | "canVote" | "disabled" | "onDelegate"> & { row: OperatorRow; label: string }) {
  if (!canVote || !row.listed) return null;
  const mine = held(row.address);
  return (
    <span className="flex flex-col gap-1 lg:items-end">
      {mine > 0n && <span className="text-caption whitespace-nowrap text-glow">You delegate {formatMonkey(mine)}</span>}
      {/* The name starts with the visible word and says what the button does: it chooses, it sends nothing. One label, as a hidden span after a colon reads with a stray space. */}
      <button type="button" aria-label={`Delegate: choose ${label} in the form above`} aria-disabled={disabled} onClick={() => { if (!disabled) onDelegate(row); }} className={`${BUTTON} w-full whitespace-nowrap lg:w-auto`}>
        Delegate
      </button>
    </span>
  );
}

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
function Name({ row, reachable }: { row: OperatorRow; reachable: boolean }) {
  const cells = operatorCells(row);
  return (
    <>
      <span className={`block break-all ${row.hostname === null ? "text-fg-3" : "text-fg"}`}>{cells.name}</span>
      <span className="block text-label text-fg-3" title={row.address}>{cells.address}</span>
      {row.listed && !reachable && <span className="mt-1 block text-label text-amber">Not in this build</span>}
    </>
  );
}

/** One page of rows, both layouts; the one the width does not use is hidden from everyone. */
export function OperatorTable({ rows, sort, held, canVote, disabled, reachable, onDelegate }: Props) {
  return (
    <>
      <ul className="space-y-2 lg:hidden" aria-label="Operators">
        {rows.map((row) => {
          const cells = operatorCells(row);
          return (
            <li key={row.address} className={`rounded border p-3 text-caption ${held(row.address) > 0n ? "border-glow" : "border-line-2"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><Name row={row} reachable={reachable(row)} /></div>
                <Role row={row} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-fg-2">
                <div><dt className="text-label text-fg-3">Delegated stake</dt><dd>{cells.delegated}</dd></div>
                <div><dt className="text-label text-fg-3">Self-bond</dt><dd>{cells.bond}</dd></div>
                <div><dt className="text-label text-fg-3">Release</dt><dd title={row.release}>{cells.release}</dd></div>
                <div className="col-span-2"><dt className="text-label text-fg-3">Handover endpoint</dt><dd className="[overflow-wrap:anywhere]">{cells.endpoint}</dd></div>
              </dl>
              <div className="mt-2"><Action row={row} label={cells.label} held={held} canVote={canVote} disabled={disabled} onDelegate={onDelegate} /></div>
            </li>
          );
        })}
      </ul>
      <div role="region" aria-label="Operators table" tabIndex={0} className="hidden overflow-x-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow lg:block">
        <table className="w-full min-w-[56rem] text-caption">
          <caption className="sr-only">Operators the registry lists, with each one&apos;s role, delegated stake and share of all stake, self-bond, release and handover endpoint, and what you delegate to it. Amounts are in MONKEY.</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" aria-sort={ariaSort("name", sort)} className={TH}>Operator</th>
              <th scope="col" aria-sort={ariaSort("role", sort)} className={TH}>Role</th>
              <th scope="col" aria-sort={ariaSort("votes", sort)} className={TH}>Delegated stake</th>
              <th scope="col" aria-sort={ariaSort("bond", sort)} className={TH}>Self-bond</th>
              <th scope="col" className={TH}>Release</th>
              <th scope="col" className={TH}>Handover endpoint</th>
              <th scope="col" className={TH}><span className="sr-only">Delegate</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cells = operatorCells(row);
              return (
                <tr key={row.address} className={`border-b border-line last:border-b-0 ${held(row.address) > 0n ? "bg-glow/5" : ""}`}>
                  <td className={`${TD} max-w-[16rem]`}><Name row={row} reachable={reachable(row)} /></td>
                  <td className={TD}><Role row={row} /></td>
                  <td className={`${TD} whitespace-nowrap text-fg`}>{cells.delegated}</td>
                  <td className={`${TD} whitespace-nowrap text-fg-2`}>{cells.bond}</td>
                  <td className={`${TD} whitespace-nowrap text-fg-2`} title={row.release}>{cells.release}</td>
                  <td className={`${TD} text-fg-2 [overflow-wrap:anywhere]`}>{cells.endpoint}</td>
                  <td className={`${TD} text-right`}><Action row={row} label={cells.label} held={held} canVote={canVote} disabled={disabled} onDelegate={onDelegate} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
