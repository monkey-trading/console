"use client";

/**
 * Who runs the node and who stands for it (monkey-trading/console#271): the operator in effect, the
 * node this console talks to, any pending election with its effective time, the account's
 * delegation, and every operator the registry lists in a table that searches, sorts and pages in the
 * page. The registry is read through the connected wallet and the node's signed route beside it. The
 * account delegates its whole stake to one candidate from the table, or clears the choice.
 */

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { NO_CANDIDATE } from "@/lib/engine/registry";
import { shortHex } from "@/lib/format";
import { delegateStake } from "@/lib/monkey/actions";
import { formatDuration } from "@/lib/monkey/figures";
import { hostnameListed, mirroredElection, shownHostname, type OperatorReads } from "@/lib/monkey/operators";
import { operatorCells } from "@/lib/staking/operator-cells";
import { countText, MAX_SEARCH, operatorRows, SORTS, tableView, type OperatorRow, type SortId } from "@/lib/staking/operator-table";
import { formatStamp } from "@/lib/time";

import { useNodeFollow, useSession } from "../ConsoleProvider";
import { Notice } from "../Notice";
import { Select } from "../Select";
import { Card, focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { Row } from "../monkey/Row";
import { BUTTON, NOTE } from "../monkey/styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "../monkey/use-monkey";
import { OperatorTable } from "./OperatorTable";

const TITLE_ID = "operators-title";
const FIELD = "min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 hover:border-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";
const PAGER = "min-h-11 rounded border border-line-2 px-3 py-1 text-caption text-fg-2 hover:border-glow hover:text-glow focus-visible:outline-2 focus-visible:outline-glow aria-disabled:cursor-not-allowed aria-disabled:text-fg-3 aria-disabled:hover:border-line-2 lg:min-h-0";

/** A registered hostname, or the address where it registered none the console could connect to. */
const nameOf = (hostname: string | null, address: string) => shownHostname(hostname) ?? shortHex(address);

/** The host of an `https://` origin. */
const hostOf = (origin: string) => new URL(origin).host;

/** The operators section. Its reads run for as long as the page is open, node or no node: a staker can always see the election and move their vote. */
export function OperatorsPanel({ operators }: { operators: OperatorReads }) {
  const { deploy, node } = useSession();
  const follow = useNodeFollow();
  const panel = useMonkeyPanel();
  const searchId = useId();
  const { named, table, route, chosen: chosenRead } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const { settling } = usePanelState();
  const nodeReadable = useConsoleSelect((state) => readBlock(state.attestation, "live") === null);
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 60_000) * 60_000);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortId>("role");
  const [page, setPage] = useState(0);
  useEffect(() => operators.walletChanged(), [operators, wallet]);
  const chosen = chosenRead.value;
  const operator = named.value;
  const inEffect = table.value?.inEffect ?? null;
  const pending = operator?.pending ?? null;
  const mirrored = pending === null ? mirroredElection(route.value, nowMs) : null;
  const rows = useMemo(() => (table.value === null ? [] : operatorRows(table.value, operator)), [table.value, operator]);
  const view = useMemo(() => tableView(rows, search, sort, page), [rows, search, sort, page]);
  const labelOf = (address: string) => {
    const row = rows.find((candidate) => candidate.address === address);
    return row === undefined ? shortHex(address) : operatorCells(row).name;
  };
  const canVote = wallet !== null && wallet.readOnly !== true && chosenRead.status === "ready";
  const send = (candidate: string, label: string) => {
    if (!busy && !settling) void delegateStake(panel, operators, candidate, label).then(() => focusHeading(TITLE_ID));
  };
  // The candidates whose registered hostname this build could not connect to, were one elected.
  const unreachable = useMemo(() => new Set(node !== null ? [] : (table.value?.candidates ?? []).filter((c) => !hostnameListed(deploy, c.hostname)).map((c) => c.address)), [node, deploy, table.value]);
  const reachable = (row: OperatorRow) => !unreachable.has(row.address);
  return (
    <Card id={TITLE_ID} title="Operators">
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <Row label="Operator in effect">{inEffect === null ? "—" : nameOf(inEffect.hostname, inEffect.candidate)}</Row>
        <Row label="Admin key the node applies">{route.value === null ? "—" : <span title={route.value.operator}>{shortHex(route.value.operator)}</span>}</Row>
        <Row label="Rotation">{(operator?.rotationEnabled ?? route.value?.rotation_enabled ?? null) === null ? "—" : (operator?.rotationEnabled ?? route.value?.rotation_enabled) ? "On" : "Off"}</Row>
        <Row label="This console talks to">{node !== null ? "The simulated node" : follow === null ? "—" : hostOf(follow.origin)}</Row>
      </dl>
      {pending !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber">
          {pending.promoted ? `A liveness promotion names ${labelOf(pending.candidate)}: its release applies now, and its admin key` : `An election named ${labelOf(pending.candidate)}, which`} takes effect at {formatStamp(pending.effectiveAtMs)} UTC{nowMs > 0 && pending.effectiveAtMs > nowMs ? `, in ${formatDuration(pending.effectiveAtMs - nowMs)}` : ""}.
        </p>
      )}
      {mirrored !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber">
          The node has logged an election naming {shortHex(mirrored.candidate)}, which applies its admin key at {formatStamp(mirrored.effectiveAtMs)} UTC, in {formatDuration(mirrored.effectiveAtMs - nowMs)}.
        </p>
      )}
      <ReadNote read={route} loading={nodeReadable ? "Reading the node's figures…" : "The node's figures wait until it is verified."} />
      {named.status === "unavailable" && table.status === "unavailable" ? (
        <p className={NOTE}>{wallet === null ? "Connect a wallet to read the operators from the chain and delegate your stake." : "This account is read-only, so no wallet reads the operators from the chain."}</p>
      ) : (
        <>
          <ReadNote read={named} loading="Reading the operator registry…" />
          <h4 className="pt-1 text-label tracking-caps text-fg-3 uppercase">Your delegation</h4>
          <ReadNote read={chosenRead} loading="Reading your vote…" />
          {canVote && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-caption text-fg">{chosen === null ? "Your stake abstains." : `Your stake votes for ${labelOf(chosen)}.`}</p>
              {chosen !== null && <button type="button" aria-disabled={busy || settling} onClick={() => send(NO_CANDIDATE, "")} className={BUTTON}>Clear my delegation</button>}
            </div>
          )}
          <Notice surface="operator" />
          <p className={NOTE}>You delegate your whole stake to one candidate, and may change the choice at any time; it counts at the next election close. Stake you have started to unstake does not vote, and stake you have not delegated abstains. Delegation changes nothing about distributions, and delegators share no rewards.</p>
          {table.status === "ready" && table.value === null && <p className={NOTE}>This build names no operator registry, so operators are not available here.</p>}
          {table.value !== null && (
            <>
              <div className="grid gap-2 pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-end">
                <div className="space-y-1">
                  <label htmlFor={searchId} className="block text-caption text-fg-2">Search operators</label>
                  <input id={searchId} type="search" value={search} maxLength={MAX_SEARCH} spellCheck={false} autoComplete="off" placeholder="Hostname or address" onChange={(event) => { setSearch(event.target.value); setPage(0); }} className={FIELD} />
                </div>
                <Select<SortId> label="Sort by" value={sort} options={SORTS} onChange={(value) => { setSort(value); setPage(0); }} />
              </div>
              {table.value.candidates.length === 0 && table.status === "ready" && <p className={NOTE}>No candidate&apos;s release has been approved yet.</p>}
              <p role="status" className="text-caption text-fg-2">{countText(view, search)}</p>
              {view.rows.length > 0 && <OperatorTable rows={view.rows} sort={sort} chosen={chosen} canVote={canVote} disabled={busy || settling} reachable={reachable} onDelegate={(row) => send(row.address, operatorCells(row).name)} />}
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
          <ReadNote read={table} loading="Reading the operators…" />
        </>
      )}
    </Card>
  );
}
