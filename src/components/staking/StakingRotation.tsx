"use client";

/**
 * The Staking section's Rotation tab (monkey-trading/console#280): the operator group in effect and the
 * next one, the current and next turns, the reassigned and refused turns, and the turn history by start
 * time, from the node's signed `GET /v1/operator`, with the next election's time from the registry's
 * `GET /v1/operators`. The tab starts only the operator reads and the older-turn reads.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { needsConsoleUpdate } from "@/lib/staking/hostnames";
import { shortHex } from "@/lib/format";
import { byStart, turnLine } from "@/lib/staking/rotation";
import { CURRENT_GROUP_RESERVE, currentGroupLine, NEXT_GROUP_RESERVE, nextGroupLine, TURN_RESERVE } from "@/lib/staking/rotation-words";
import { joinHistory } from "@/lib/staking/turn-history-reads";
import { withAddress } from "@/lib/staking/operator-cells";

import { useSession } from "../ConsoleProvider";
import { focusHeading } from "../monkey/Card";
import { Row } from "../monkey/Row";
import { ReadNote } from "../monkey/ReadNote";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { Reassignments } from "./Reassignments";
import { SetCard } from "./SetCard";
import { TurnHistoryCard } from "./TurnHistoryCard";
import { useOperatorLabel } from "./use-operator-label";

/** The Rotation tab. Its figures are hidden, not unmounted, while the node is not trusted, as on the other tabs. */
export function StakingRotation() {
  const { operators, turns } = useStaking();
  const { deploy, node } = useSession();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const nowMs = useConsoleSelect((state) => Math.floor(state.now / 60_000) * 60_000);
  const { route, rotation, list } = useSyncExternalStore(operators.subscribe, operators.getSnapshot, operators.getSnapshot);
  const pages = useSyncExternalStore(turns.subscribe, turns.getSnapshot, turns.getSnapshot);
  const labelOf = useOperatorLabel(operators);
  const nameOf = useCallback((address: string) => withAddress(labelOf(address), address), [labelOf]);
  const rows = list.value?.rows;
  // A member whose registered hostname this build does not list could not be followed to: the console needs updating.
  const needsUpdate = useCallback((address: string) => {
    return node === null && needsConsoleUpdate(deploy, rows?.find((candidate) => candidate.address === address));
  }, [node, deploy, rows]);
  const history = useMemo(() => (rotation === null ? null : joinHistory(rotation.history, pages.older)), [rotation, pages.older]);
  const records = useMemo(() => (history === null ? [] : byStart(history.records)), [history]);
  const signer = rotation?.signer ?? null;
  // Before a first read lands the cards say they are reading; a node that cannot give the rotation says so instead.
  const unread = route.status === "loading" ? "Loading the rotation…" : "The rotation could not be loaded.";
  const rotationOn = list.value?.rotationEnabled ?? route.value?.rotation_enabled ?? null;
  const current = rotation?.set ?? null;
  const next = rotation?.nextSet ?? null;
  const nextContext = { current: current !== null, rotationOn, electionAtMs: list.value?.nextElectionMs ?? null };
  return (
    <div className={`mt-4 ${trusted ? "grid" : "hidden"} gap-4`}>
      <dl className="grid gap-x-8 gap-y-2 rounded-xl border border-line-2 bg-ink-1 p-4 sm:grid-cols-2">
        <Row label="Operator rotation">{rotationOn === null ? "—" : rotationOn ? "On" : "Off"}</Row>
        <Row label="Vault's signing key">{signer === null ? "—" : <span title={signer.address}>{shortHex(signer.address)} (key version {signer.epoch})</span>}</Row>
        <Row label="Current turn" reserve={TURN_RESERVE}>{rotation === null ? "—" : turnLine(rotation.turn, nameOf, "No turn in progress")}</Row>
        <Row label="Next turn" reserve={TURN_RESERVE}>{rotation === null ? "—" : turnLine(rotation.nextTurn, nameOf, "Not yet drawn")}</Row>
      </dl>
      <ReadNote read={route} loading="Loading the rotation…" quiet />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <SetCard
          id="rotation-set-title" title="Current operator group" set={current} reserve={CURRENT_GROUP_RESERVE} nameOf={labelOf} needsUpdate={needsUpdate}
          line={rotation === null ? unread : current === null ? "No group of operators is running the trading server in turns." : currentGroupLine(current, nowMs)}
        />
        <SetCard
          id="rotation-next-title" title="Next operator group" set={next} reserve={NEXT_GROUP_RESERVE} nameOf={labelOf} needsUpdate={needsUpdate}
          line={rotation === null ? unread : nextGroupLine(next, nextContext, nowMs)}
        />
      </div>
      {/* Both cards are there from the first paint, each in a viewport of one height, so nothing moves when the first read lands. */}
      <Reassignments records={records} empty={rotation === null ? unread : "None of the turns shown was reassigned or refused."} nameOf={labelOf} />
      <TurnHistoryCard
        records={records} empty={rotation === null ? unread : "No turns have taken place yet."} more={history === null ? null : history.next !== null} truncated={history?.truncated ?? false} reading={pages.reading} error={pages.error}
        onMore={() => {
          if (rotation === null) return;
          // The last page removes the button that has focus: focus goes to the card's heading, as on the other history cards.
          void turns.loadOlder(rotation.history).then(() => { if (joinHistory(rotation.history, turns.getSnapshot().older).next === null) focusHeading("rotation-history-title"); });
        }}
        nameOf={labelOf}
      />
      <p className={NOTE}>The trading server is run in turns by a group of operators chosen at an election. For each turn, one operator in the group is drawn at random, with a chance in proportion to its weight, which is the stake delegated to it when the group was chosen, so an operator&apos;s expected share of turns equals its share of the group&apos;s total weight. When a turn begins, this app connects to the new operator&apos;s server once that server has been verified.</p>
    </div>
  );
}
