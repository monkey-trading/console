"use client";

/**
 * Who runs the node and who stands for it: the operator in effect, any pending election with its
 * effective time, and the candidates with their delegated stake, eligibility and hostname, from the
 * registry through the connected wallet and from the node's signed route. The connected account
 * delegates its whole stake to one candidate from here, or clears the choice.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { NO_CANDIDATE, type Candidate } from "@/lib/engine/registry";
import { formatMonkey, formatRate, shortHex } from "@/lib/format";
import { delegateStake } from "@/lib/monkey/actions";
import { formatDuration, shareBps } from "@/lib/monkey/figures";
import { hostnameListed, mirroredElection, OperatorReads, shownHostname } from "@/lib/monkey/operators";
import { formatStamp } from "@/lib/time";

import { useNodeFollow, useSession } from "../ConsoleProvider";
import { Card, focusHeading } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { BUTTON, LINK_BUTTON, NOTE } from "./styles";
import { useConsoleSelect, useMonkeyPanel, usePanelState } from "./use-monkey";

const NOT_A_HOSTNAME = "Not a plain hostname";

/** A registered hostname, or the candidate's address where it registered none the console could connect to. */
const nameOf = (hostname: string | null, address: string) => shownHostname(hostname) ?? shortHex(address);

/** The host of an `https://` origin. */
const hostOf = (origin: string) => new URL(origin).host;

export function OperatorPanel() {
  const { store, deploy, node } = useSession();
  const follow = useNodeFollow();
  const panel = useMonkeyPanel();
  const [operators] = useState(() => new OperatorReads(store));
  const { named, table, route } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const { wallet: figures, settling } = usePanelState();
  const wallet = useConsoleSelect((state) => state.wallet);
  const busy = useConsoleSelect((state) => state.busy);
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 60_000) * 60_000);
  useEffect(() => operators.start(() => document.visibilityState === "hidden"), [operators]);
  useEffect(() => operators.walletChanged(), [operators, wallet]);
  const mine = wallet !== null && figures.address === wallet.address;
  const position = mine ? figures.position.value : null;
  const chosen = position?.delegate ?? null;
  const operator = named.value;
  const pending = operator?.pending ?? null;
  const mirrored = pending === null ? mirroredElection(route.value, nowMs) : null;
  const candidates = useMemo(() => [...(table.value?.candidates ?? [])].sort((a, b) => (a.votes === b.votes ? 0 : a.votes > b.votes ? -1 : 1)), [table.value]);
  const pendingName = pending === null ? null : nameOf(candidates.find((c) => c.address === pending.candidate)?.hostname ?? null, pending.candidate);
  const totalStaked = table.value?.totalStaked ?? 0n;
  const canVote = wallet !== null && wallet.readOnly !== true && position !== null && position.stakingEnabled;
  const send = (candidate: string, label: string) => {
    if (!busy && !settling) void delegateStake(panel, operators, candidate, label).then(() => focusHeading("operator-title"));
  };
  return (
    <Card id="operator-title" title="Operator" aside={wallet !== null && wallet.readOnly !== true && <button type="button" onClick={() => { void operators.refreshChain(); void operators.refreshNode(); void panel.refreshWallet(true); }} className={LINK_BUTTON}>Refresh<span className="sr-only"> the operator</span></button>}>
      <dl className="space-y-2">
        <Row label="Operator in effect">{operator === null ? "—" : nameOf(operator.hostname, operator.candidate)}</Row>
        <Row label="Admin key the node applies">{route.value === null ? "—" : <span title={route.value.operator}>{shortHex(route.value.operator)}</span>}</Row>
        <Row label="Rotation">{(operator?.rotationEnabled ?? route.value?.rotation_enabled ?? null) === null ? "—" : (operator?.rotationEnabled ?? route.value?.rotation_enabled) ? "On" : "Off, so the deployer is the operator"}</Row>
        <Row label="This console talks to">{node !== null ? "The simulated node" : follow === null ? "—" : hostOf(follow.origin)}</Row>
      </dl>
      {pending !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber">
          {pending.promoted ? `A liveness promotion names ${pendingName ?? ""}: its release applies now, and its admin key` : `An election named ${pendingName ?? ""}, which`} takes effect at {formatStamp(pending.effectiveAtMs)} UTC{pending.effectiveAtMs > nowMs ? `, in ${formatDuration(pending.effectiveAtMs - nowMs)}` : ""}.
        </p>
      )}
      {mirrored !== null && (
        <p className="rounded border border-amber/40 bg-amber/10 p-3 text-caption leading-relaxed text-amber">
          The node has logged an election naming {shortHex(mirrored.candidate)}, which applies its admin key at {formatStamp(mirrored.effectiveAtMs)} UTC, in {formatDuration(mirrored.effectiveAtMs - nowMs)}.
        </p>
      )}
      <ReadNote read={route} />
      {named.status === "unavailable" && table.status === "unavailable" ? (
        <p className={NOTE}>{wallet === null ? "Connect a wallet to read the candidates from the chain and delegate your stake." : "This account is read-only, so no wallet reads the candidates from the chain."}</p>
      ) : (
        <>
          <ReadNote read={named} loading="Reading the operator registry…" />
          {table.status === "ready" && table.value === null && <p className={NOTE}>This build names no operator registry, so candidates are not available here.</p>}
          {table.value !== null && (
            <>
              {candidates.length === 0 && table.status === "ready" && <p className={NOTE}>No candidate&apos;s release has been approved yet.</p>}
              {candidates.length > 0 && <h4 className="pt-1 text-label tracking-caps text-fg-3 uppercase">Candidates</h4>}
              <ul className="space-y-2">
                {candidates.map((candidate) => (
                  <CandidateRow key={candidate.address} candidate={candidate} totalStaked={totalStaked} chosen={chosen === candidate.address} canVote={canVote} disabled={busy || settling} listed={node !== null || hostnameListed(deploy, candidate.hostname)} onDelegate={send} />
                ))}
              </ul>
              {table.status !== "ready" && <ReadNote read={table} loading="Reading the candidates…" />}
            </>
          )}
          {canVote && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-caption text-fg">{chosen === null ? "Your stake abstains." : `Your stake votes for ${nameOf(candidates.find((c) => c.address === chosen)?.hostname ?? null, chosen)}.`}</p>
              {chosen !== null && <button type="button" aria-disabled={busy || settling} onClick={() => send(NO_CANDIDATE, "")} className={BUTTON}>Clear my delegation</button>}
            </div>
          )}
          <p className={NOTE}>You delegate your whole stake to one candidate, and may change the choice at any time; it counts at the next election close. Stake you have started to unstake does not vote, and stake you have not delegated abstains. Delegation changes nothing about distributions, and delegators share no rewards.</p>
        </>
      )}
    </Card>
  );
}

function CandidateRow({ candidate, totalStaked, chosen, canVote, disabled, listed, onDelegate }: { candidate: Candidate; totalStaked: bigint; chosen: boolean; canVote: boolean; disabled: boolean; listed: boolean; onDelegate: (candidate: string, label: string) => void }) {
  const hostname = shownHostname(candidate.hostname);
  const label = nameOf(candidate.hostname, candidate.address);
  return (
    <li className={`rounded border p-3 ${chosen ? "border-glow" : "border-line-2"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-caption break-all text-fg">{hostname ?? NOT_A_HOSTNAME}</span>
        <span className={`text-label ${candidate.eligible ? "text-glow" : "text-amber"}`}>{candidate.eligible ? "Eligible" : "Not eligible"}</span>
      </div>
      <dl className="mt-2 space-y-1">
        <Row label="Delegated stake">{formatMonkey(candidate.votes)} ({formatRate(shareBps(candidate.votes, totalStaked))})</Row>
        <Row label="Candidate"><span title={candidate.address}>{shortHex(candidate.address)}</span></Row>
      </dl>
      {!listed && <p className="mt-2 text-caption leading-relaxed text-amber">This console build does not list this hostname, so it could not connect there if this candidate were elected.</p>}
      {canVote && (chosen
        ? <p className="mt-2 text-caption text-glow">Your stake votes for this candidate.</p>
        : <button type="button" aria-disabled={disabled} onClick={() => onDelegate(candidate.address, label)} className={`${BUTTON} mt-2 w-full`}>Delegate<span className="sr-only"> your stake to {label}</span></button>)}
    </li>
  );
}
