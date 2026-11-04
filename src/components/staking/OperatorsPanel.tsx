"use client";

/**
 * Who runs the node and who stands for it (monkey-trading/console#271, #279): the operator in effect,
 * the node this console talks to, any pending election with its effective time, the account's
 * delegations, and every candidate the registry lists in a table that searches, sorts and pages in
 * the page. The list is the node's signed `GET /v1/operators`, as the custody quorum read it at a
 * final block the card names; the account's delegations are its wallet's own chain reads.
 */

import { useId, useMemo, useState, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { groupThousands, shortHex } from "@/lib/format";
import { formatDuration } from "@/lib/monkey/figures";
import { mirroredElection, type OperatorReads } from "@/lib/monkey/operators";
import type { DelegationReads } from "@/lib/staking/delegation-reads";
import { delegationTo } from "@/lib/staking/delegations";
import { hostnameListed } from "@/lib/staking/hostnames";
import { withAddress } from "@/lib/staking/operator-cells";
import { countText, MAX_SEARCH, SORTS, tableView, type OperatorRow, type SortId } from "@/lib/staking/operator-table";
import { formatStamp } from "@/lib/time";

import { useNodeFollow, useSession } from "../ConsoleProvider";
import { Notice } from "../Notice";
import { Select } from "../Select";
import { Card } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { Row } from "../monkey/Row";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect, usePanelState } from "../monkey/use-monkey";
import { DELEGATE_FORM_ID, Delegations } from "./Delegations";
import { OperatorTable } from "./OperatorTable";
import { useOperatorLabel } from "./use-operator-label";

const TITLE_ID = "operators-title";
const FIELD = "min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 hover:border-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";
const PAGER = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 aria-disabled:hover:border-line-2 lg:min-h-0";

/** The host of an `https://` origin. */
const hostOf = (origin: string) => new URL(origin).host;

/** The operators section. The list is the node's, shown once its answers may be read; the account's delegations are the chain's, shown whatever the node's state. */
export function OperatorsPanel({ operators, delegations }: { operators: OperatorReads; delegations: DelegationReads }) {
  const { deploy, node } = useSession();
  const follow = useNodeFollow();
  const searchId = useId();
  const { list: listRead, route, held: heldList } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const delegationsRead = useSyncExternalStore(delegations.subscribe, delegations.getSnapshot, delegations.getSnapshot);
  const { settling } = usePanelState();
  const nodeReadable = useConsoleSelect((state) => readBlock(state.attestation, "live") === null);
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 60_000) * 60_000);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortId>("role");
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState("");
  const [typedTo, setTypedTo] = useState("");
  const list = listRead.value;
  const rows = useMemo(() => list?.rows ?? [], [list]);
  const view = useMemo(() => tableView(rows, search, sort, page), [rows, search, sort, page]);
  const labelOf = useOperatorLabel(operators);
  const pending = list?.pending ?? null;
  const mirrored = pending === null ? mirroredElection(route.value, nowMs) : null;
  const mine = wallet !== null && delegationsRead.account === wallet.address ? delegationsRead.read.value : null;
  const delegatedTo = (address: string) => (mine === null ? 0n : delegationTo(mine.delegations, address));
  const canVote = wallet !== null && wallet.readOnly !== true && mine !== null;
  // The candidates whose registered hostname this build could not connect to, were one elected.
  const unreachable = useMemo(() => new Set(node !== null ? [] : rows.filter((row) => row.listed && !hostnameListed(deploy, row.registeredHostname)).map((row) => row.address)), [node, deploy, rows]);
  const reachable = (row: OperatorRow) => !unreachable.has(row.address);
  const rotation = list?.rotationEnabled ?? route.value?.rotation_enabled ?? null;
  return (
    <Card id={TITLE_ID} title="Operators">
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <Row label="Operator in effect">{list === null ? "—" : labelOf(list.inEffect)}</Row>
        <Row label="Admin key the node applies">{route.value === null ? "—" : <span title={route.value.operator}>{shortHex(route.value.operator)}</span>}</Row>
        <Row label="Rotation">{rotation === null ? "—" : rotation ? "On" : "Off"}</Row>
        <Row label="This console talks to">{node !== null ? "The simulated node" : follow === null ? "—" : hostOf(follow.origin)}</Row>
      </dl>
      {pending !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber">
          {pending.promoted ? `A liveness promotion names ${withAddress(labelOf(pending.candidate), pending.candidate)}: its release applies now, and its admin key` : `An election named ${withAddress(labelOf(pending.candidate), pending.candidate)}, which`} takes effect at {formatStamp(pending.effectiveAtMs)} UTC{nowMs > 0 && pending.effectiveAtMs > nowMs ? `, in ${formatDuration(pending.effectiveAtMs - nowMs)}` : ""}.
        </p>
      )}
      {mirrored !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber">
          The node has logged an election naming {withAddress(labelOf(mirrored.candidate), mirrored.candidate)}, which applies its admin key at {formatStamp(mirrored.effectiveAtMs)} UTC, in {formatDuration(mirrored.effectiveAtMs - nowMs)}.
        </p>
      )}
      <ReadNote read={route} loading={nodeReadable ? "Reading the node's figures…" : "The node's figures wait until it is verified."} />
      <h4 className="pt-1 text-label tracking-caps text-fg-3 uppercase">Your delegations</h4>
      <Delegations operators={operators} lists={{ list: listRead, held: heldList }} delegations={delegations} read={delegationsRead} target={target} onTarget={setTarget} typedTo={typedTo} onTypedTo={setTypedTo} labelOf={labelOf} titleId={TITLE_ID} />
      {/* Beside the forms, and there with no wallet too: a change's outcome outlives the connection that sent it. */}
      <Notice surface="operator" />
      <p className={NOTE}>You delegate amounts of your stake to any candidates the registry lists, and may move or take them back at any time; the next election close counts them. Stake you have not delegated abstains, and stake you have started to unstake does not vote. Delegation changes nothing about distributions, and delegators share no rewards.</p>
      {list !== null && (
        <>
          <h4 className="pt-2 text-label tracking-caps text-fg-3 uppercase">All operators</h4>
          <p className={NOTE}>As the registry stood at final block {groupThousands(BigInt(list.block.number))}, at {formatStamp(list.block.timeMs)} UTC, read by the node from the chain. It is read again by itself, and counts a delegation once its block is final.</p>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-end">
            <div className="space-y-1">
              <label htmlFor={searchId} className="block text-caption text-fg-2">Search operators</label>
              <input id={searchId} type="search" value={search} maxLength={MAX_SEARCH} spellCheck={false} autoComplete="off" placeholder="Hostname or address" onChange={(event) => { setSearch(event.target.value); setPage(0); }} className={FIELD} />
            </div>
            <Select<SortId> label="Sort by" value={sort} options={SORTS} onChange={(value) => { setSort(value); setPage(0); }} />
          </div>
          {!rows.some((row) => row.listed) && <p className={NOTE}>No candidate&apos;s release has been approved yet.</p>}
          <p role="status" className="text-caption text-fg-2">{countText(view, search)}</p>
          {view.rows.length > 0 && (
            <OperatorTable
              rows={view.rows} sort={sort} held={delegatedTo} canVote={canVote} disabled={busy || settling} reachable={reachable}
              onDelegate={(row) => {
                // A deliberate choice: it replaces any address typed in the form, which then names this candidate.
                setTarget(row.address);
                setTypedTo("");
                document.getElementById(DELEGATE_FORM_ID)?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.focus();
              }}
            />
          )}
          {view.pages > 1 && (
            <nav aria-label="Operator pages" className="flex flex-wrap items-center gap-2">
              <button type="button" aria-disabled={view.page === 0} onClick={() => { if (view.page > 0) setPage(view.page - 1); }} className={PAGER}>Previous<span className="sr-only"> page of operators</span></button>
              <span className="text-caption text-fg-2">Page {view.page + 1} of {view.pages}</span>
              <button type="button" aria-disabled={view.page >= view.pages - 1} onClick={() => { if (view.page < view.pages - 1) setPage(view.page + 1); }} className={PAGER}>Next<span className="sr-only"> page of operators</span></button>
            </nav>
          )}
          {unreachable.size > 0 && <p className={NOTE}>Not in this build: this console build does not list that operator&apos;s hostname, so it could not connect there if the operator were elected.</p>}
          <p className={NOTE}>The standby is the eligible candidate the registry would promote, while rotation is on and no election waits, once the vault has gone its liveness timeout without a checkpoint. The release is the enclave build and configuration an operator runs, as the vault names it.</p>
        </>
      )}
      <ReadNote read={listRead} loading={nodeReadable ? "Reading the operator list…" : "The operator list waits until the node is verified."} />
    </Card>
  );
}
