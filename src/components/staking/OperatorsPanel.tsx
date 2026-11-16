"use client";

/**
 * Who runs the node and who stands for it (monkey-trading/console#271, #279, #309): the operator in
 * effect, the node this console talks to, any pending election with its effective time, and every
 * candidate the registry lists in a table that searches, sorts and pages in the page, with Delegate,
 * Move and Take back on each row. The list is the node's signed `GET /v1/operators`, as the custody
 * quorum read it at a final block the card names; the account's delegations are its wallet's own
 * chain reads, and the Yours rows, their editors and the editors' amounts and previews work from
 * them alone — with no list held at all they still render, each with Move and Take back. While the
 * node is down or unverified the last list verified stays, labelled with when, at which block and
 * why, its rows still delegate and move, and "Delegate to an address" takes a typed address the
 * chain alone checks.
 */

import { useEffect, useId, useMemo, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { groupThousands, shortHex } from "@/lib/format";
import { changeDelegation, type DelegationChange } from "@/lib/monkey/actions";
import { spokenLongCountdown } from "@/lib/monkey/countdown";
import { mirroredElection, type OperatorReads } from "@/lib/monkey/operators";
import { candidateSource, nodeBlocked, offersTyped, type NoList } from "@/lib/staking/candidate-choice";
import type { DelegationReads } from "@/lib/staking/delegation-reads";
import { closeEditor, openTypedEditor, TYPED_EDITOR } from "@/lib/staking/delegation-form";
import { editorOwnsFocusLoss } from "@/lib/staking/delegation-focus";
import { delegationTo } from "@/lib/staking/delegations";
import { hostnameListed } from "@/lib/staking/hostnames";
import { withAddress } from "@/lib/staking/operator-cells";
import { withMembership } from "@/lib/staking/operator-membership";
import { countText, MAX_SEARCH, SORTS, tableView, yoursRows, type SortId } from "@/lib/staking/operator-table";
import { turnLine } from "@/lib/staking/rotation";
import { TURN_RESERVE } from "@/lib/staking/rotation-words";
import { formatStamp } from "@/lib/time";

import { useNodeFollow, useSession } from "../ConsoleProvider";
import { Notice } from "../Notice";
import { Select } from "../Select";
import { Card, focusHeading } from "../monkey/Card";
import { ReadNote } from "../monkey/ReadNote";
import { Row } from "../monkey/Row";
import { NOTE, TOGGLE } from "../monkey/styles";
import { useConsoleSelect, useMonkeyPanel } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { DelegationEditor } from "./DelegationEditor";
import { OperatorTable } from "./OperatorTable";
import { useOperatorLabel } from "./use-operator-label";

const TITLE_ID = "operators-title";
const FIELD = "min-h-11 w-full rounded border border-edge bg-ink px-2 py-2 text-data text-fg placeholder:text-fg-3 hover:border-glow focus-visible:outline-2 focus-visible:outline-glow lg:min-h-0";

/** Why the list in hand is not the node's current one, as the held list's note ends. */
const WHY: Record<NoList, string> = { unverified: "the trading server is not currently verified", clock: "your device clock is incorrect", unread: "the current operator list cannot be loaded" };

/** The host of an `https://` origin. */
const hostOf = (origin: string) => new URL(origin).host;

/** The operators section. The list is the node's, shown once its answers may be read; the account's delegations are the chain's, shown whatever the node's state. */
export function OperatorsPanel({ operators, delegations }: { operators: OperatorReads; delegations: DelegationReads }) {
  const { delegateEditing, setDelegateEditing, table, setTable, typedSlot, setTypedSlot } = useStaking();
  const panel = useMonkeyPanel();
  const { deploy, node, store } = useSession();
  const follow = useNodeFollow();
  const searchId = useId();
  const showId = useId();
  const typedId = useId();
  const { list: listRead, route, rotation: schedule, held: heldList } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const delegationsRead = useSyncExternalStore(delegations.subscribe, delegations.getSnapshot, delegations.getSnapshot);
  const nodeReadable = useConsoleSelect((state) => readBlock(state.attestation, "live") === null);
  const wallet = useConsoleSelect((state) => state.wallet);
  const decided = useConsoleSelect((state) => state.walletDecided);
  const busy = useConsoleSelect((state) => state.busy);
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 60_000) * 60_000);
  const list = listRead.value;
  const mine = wallet !== null && delegationsRead.account === wallet.address ? delegationsRead.read.value : null;
  const canVote = wallet !== null && wallet.readOnly !== true && mine !== null;
  // The operator reads' own rule for whether the node's answers may be read, so the table and its editors agree.
  const blocked = useConsoleSelect((state) => nodeBlocked(state.attestation));
  const source = candidateSource(listRead, heldList, blocked);
  // With no list held — nothing verified yet, or a list the node cannot serve — the Yours rows still
  // render: they are the chain's read alone, no list's.
  const view = source.kind === "current" ? list : source.kind === "held" ? heldList?.view ?? null : null;
  // Each row says whether it is in the rotation set in effect, from the node's route as read (monkey-trading/console#280).
  const rows = useMemo(() => withMembership(view?.rows ?? [], schedule?.set ?? null), [view, schedule]);
  const yours = useMemo(() => (mine === null ? [] : yoursRows(rows, mine.delegations, view !== null)), [mine, rows, view]);
  const { search, sort, page, show } = table;
  const shown = view === null || show === "yours" ? yours : rows;
  const pageView = useMemo(() => tableView(shown, search, sort, page), [shown, search, sort, page]);
  const listed = useMemo(() => rows.filter((row) => row.listed), [rows]);
  const labelOf = useOperatorLabel(operators);
  const nameOf = (address: string) => withAddress(labelOf(address), address);
  const delegatedTo = (address: string) => (mine === null ? 0n : delegationTo(mine.delegations, address));
  // The candidates whose registered hostname this build could not connect to, were one elected.
  const unreachable = useMemo(() => new Set(node !== null ? [] : rows.filter((row) => row.listed && !hostnameListed(deploy, row.registeredHostname)).map((row) => row.address)), [node, deploy, rows]);
  const reachable = (row: { address: string }) => !unreachable.has(row.address);
  const pending = view?.pending ?? null;
  const mirrored = pending === null ? mirroredElection(route.value, nowMs) : null;
  const rotation = view?.rotationEnabled ?? route.value?.rotation_enabled ?? null;
  // Every control a delegation sends through reopens on the chain's read alone, whatever the node's
  // own re-reads are doing: no operator may hold a staker's vote in place.
  const send = (next: DelegationChange, onLanded: () => void) => {
    const origin = document.activeElement?.closest("[data-delegation-editor]") ?? null;
    const account = wallet?.address ?? null;
    const version = delegateEditing.editorVersion;
    return changeDelegation(panel, operators, delegations, next, onLanded).then((landed) => {
      if (landed && (store.getSnapshot().wallet?.address ?? null) === account) {
        setDelegateEditing((now) => closeEditor(now, version));
        // The sending editor closes with its focus, wherever it moved within it or however the refreshed read removed its row first.
        if (editorOwnsFocusLoss(origin, document.activeElement, document.body, version)) document.getElementById(TITLE_ID)?.focus();
      }
    });
  };
  const typedOffered = canVote && (offersTyped(source, delegateEditing.typedTo) || delegateEditing.typedOpen);
  useEffect(() => {
    if (typedOffered && !typedSlot) setTypedSlot(true);
  }, [typedOffered, typedSlot, setTypedSlot]);
  const setView = (part: Partial<typeof table>) => setTable({ ...table, ...part });
  return (
    <Card id={TITLE_ID} title="Operators">
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <Row label="Current operator">{list === null ? "—" : labelOf(list.inEffect)}</Row>
        <Row label="Today's turn" reserve={TURN_RESERVE}>{schedule === null ? "—" : turnLine(schedule.turn, nameOf, "No one has today's turn")}</Row>
        <Row label="Tomorrow's turn" reserve={TURN_RESERVE}>{schedule === null ? "—" : turnLine(schedule.nextTurn, nameOf, "Not drawn yet")}</Row>
        <Row label="Operator key in use">{route.value === null ? "—" : <span title={route.value.operator}>{shortHex(route.value.operator)}</span>}</Row>
        <Row label="Daily rotation">{rotation === null ? "—" : rotation ? "On" : "Off"}</Row>
        <Row label="Connected server">{node !== null ? "Demo server in your browser" : follow === null ? "—" : hostOf(follow.origin)}</Row>
      </dl>
      {pending !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber [overflow-wrap:anywhere]">
          {pending.promoted ? `${withAddress(labelOf(pending.candidate), pending.candidate)} is taking over as operator because the current operator stopped responding. Its release is already in use, and its operator key` : `${withAddress(labelOf(pending.candidate), pending.candidate)} has won the election. Its operator key`} takes effect at {formatStamp(pending.effectiveAtMs)} UTC{nowMs > 0 && pending.effectiveAtMs > nowMs ? `, in ${spokenLongCountdown(pending.effectiveAtMs, nowMs)}` : ""}.
        </p>
      )}
      {mirrored !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber [overflow-wrap:anywhere]">
          The trading server has recorded the election of {withAddress(labelOf(mirrored.candidate), mirrored.candidate)}. Its operator key takes effect at {formatStamp(mirrored.effectiveAtMs)} UTC, in {spokenLongCountdown(mirrored.effectiveAtMs, nowMs)}.
        </p>
      )}
      <ReadNote read={route} loading={nodeReadable ? "Loading figures…" : "Figures will appear once the trading server has been verified."} quiet />
      {wallet === null && decided && <p className={NOTE}>Connect a wallet to delegate your stake.</p>}
      {wallet?.readOnly === true && <p className={NOTE}>You are viewing this account in read-only mode, so its delegations are not shown and no stake can be delegated from it.</p>}
      {wallet !== null && wallet.readOnly !== true && mine === null && delegationsRead.read.status === "unavailable" && (
        <p className={NOTE}>Delegation is not currently available.</p>
      )}
      {source.kind === "held" && (
        <p className={NOTE}>This is the operator list as last verified at {formatStamp(source.verifiedAtMs)} UTC (confirmed block {groupThousands(BigInt(source.block))}), shown because {WHY[source.why]}.</p>
      )}
      {wallet !== null && wallet.readOnly !== true && delegationsRead.account === wallet.address && (delegationsRead.read.status === "loading" || delegationsRead.read.status === "failed") && (
        <ReadNote read={delegationsRead.read} loading="Loading your delegations…" quiet />
      )}
      {/* No single operator may stop a staker voting away from it: off the node's current list, an address the chain alone checks stays a way. The block stays while its editor is open, so clearing the typed address never hides it under the visitor's cursor. */}
      {typedOffered && mine !== null && (
        <div>
          <button
            type="button"
            aria-expanded={delegateEditing.typedOpen}
            aria-controls={`${typedId}-editor`}
            onClick={() => {
              const open = !delegateEditing.typedOpen;
              setDelegateEditing(openTypedEditor(delegateEditing, open));
              if (!open && !offersTyped(source, delegateEditing.typedTo)) focusHeading(TITLE_ID);
            }}
            className={TOGGLE}
          >
            Delegate to an address
          </button>
          {delegateEditing.typedOpen && (
            <div id={`${typedId}-editor`} data-delegation-editor={delegateEditing.editorVersion} className="mt-2 rounded border border-line-2 p-3">
              <DelegationEditor mode="delegate" candidate={TYPED_EDITOR} label="" chain={mine} options={[]} source={source} editing={delegateEditing} onEdit={setDelegateEditing} disabled={busy || delegationsRead.settling} nameOf={nameOf} send={send} />
            </div>
          )}
        </div>
      )}
      {/* Once offered, the slot stays when the node's current list withdraws the way — the chain's read can land before the first list does — so the toolbar and rows shown under it do not move up. */}
      {!typedOffered && typedSlot && canVote && (
        <div aria-hidden="true" inert className="invisible"><span className={`${TOGGLE} inline-block`}>Delegate to an address</span></div>
      )}
      {(view !== null || yours.length > 0) && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[min(14rem,100%)] flex-1 space-y-1">
              <label htmlFor={searchId} className="block text-caption text-fg-2">Search operators</label>
              <input id={searchId} type="search" value={search} maxLength={MAX_SEARCH} spellCheck={false} autoComplete="off" placeholder="Name or address" onChange={(event) => { setView({ search: event.target.value, page: 0 }); }} className={FIELD} />
            </div>
            <div className="space-y-1">
              <span id={showId} className="block text-caption text-fg-2">Show</span>
              <div role="group" aria-labelledby={showId} className="flex gap-2">
                <button type="button" aria-pressed={view !== null && show === "all"} aria-disabled={view === null} onClick={() => { if (view !== null) setView({ show: "all", page: 0 }); }} className={TOGGLE}>All {view === null ? "—" : rows.length}</button>
                <button type="button" aria-pressed={view === null || show === "yours"} onClick={() => { setView({ show: "yours", page: 0 }); }} className={TOGGLE}>Yours {yours.length}</button>
              </div>
            </div>
            <div className="min-w-0 max-w-full">
              <Select<SortId> label="Sort by" value={sort} options={SORTS} onChange={(value) => { setView({ sort: value, page: 0 }); }} />
            </div>
          </div>
          {view !== null && !rows.some((row) => row.listed) && <p className={NOTE}>No candidate has been approved yet.</p>}
          <p role="status" className="text-caption text-fg-2">{countText(pageView, search)}</p>
          {pageView.rows.length > 0 && (
            <OperatorTable
              rows={pageView.rows} sort={sort} held={delegatedTo} chain={mine} canVote={canVote} disabled={busy || delegationsRead.settling}
              reachable={reachable} listed={listed} source={source} editing={delegateEditing} onEdit={setDelegateEditing} nameOf={nameOf} send={send}
            />
          )}
          {pageView.pages > 1 && (
            <nav aria-label="Operator pages" className="flex flex-wrap items-center gap-2">
              <button type="button" aria-disabled={pageView.page === 0} onClick={() => { if (pageView.page > 0) setView({ page: pageView.page - 1 }); }} className={TOGGLE}>Previous<span className="sr-only"> page of operators</span></button>
              <span className="text-caption text-fg-2">Page {pageView.page + 1} of {pageView.pages}</span>
              <button type="button" aria-disabled={pageView.page >= pageView.pages - 1} onClick={() => { if (pageView.page < pageView.pages - 1) setView({ page: pageView.page + 1 }); }} className={TOGGLE}>Next<span className="sr-only"> page of operators</span></button>
            </nav>
          )}
          {/* After the rows, where it arrives with the list: the toolbar and the chain's rows already shown above never move for it. */}
          {view !== null && <p className={NOTE}>This list is as at confirmed block {groupThousands(BigInt(view.block.number))}, recorded at {formatStamp(view.block.timeMs)} UTC. It updates automatically, and a new delegation appears once the block containing it has been confirmed.</p>}
        </>
      )}
      {/* Beside the table, and there with no wallet too: a change's outcome outlives the connection that sent it. */}
      <Notice surface="operator" />
      {/* Not painted while the first list is on its way: the rows it brings land above these notes, and what is shown never moves for them. */}
      {source.kind !== "loading" && (
        <>
          <p className={NOTE}>You may delegate any part of your stake to listed candidates, and move a delegation or take it back at any time. Delegations are counted at the next election. Undelegated stake does not carry a vote, and neither does stake that you are unstaking. Delegating does not change your USDC distributions, and you do not share in an operator&apos;s rewards.</p>
          {unreachable.size > 0 && <p className={NOTE}>An operator marked as needing an app update runs server software that this version of the app cannot connect to. If that operator were elected, you would need an updated version of the app to connect to its server.</p>}
          <p className={NOTE}>The standby is the candidate that takes over as operator if the vault goes too long without receiving an update from the trading server. This applies while operator rotation is active and no election is pending. An operator&apos;s release is the exact server software and configuration that it runs.</p>
        </>
      )}
      <ReadNote read={listRead} loading={nodeReadable ? "Loading the operator list…" : "The operator list will appear once the trading server has been verified."} />
    </Card>
  );
}
