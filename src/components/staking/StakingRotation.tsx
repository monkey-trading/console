"use client";

/**
 * The Staking section's Rotation tab (monkey-trading/console#280): the rotation set in effect and the
 * next one, today's and tomorrow's turns, the skips and promotions, and the turn history, from the
 * node's signed `GET /v1/operator`. The tab starts only the operator reads and the older-turn reads.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";
import { needsConsoleUpdate } from "@/lib/staking/hostnames";
import { shortHex } from "@/lib/format";
import { turnLine } from "@/lib/staking/rotation";
import { TURN_RESERVE } from "@/lib/staking/rotation-words";
import { joinHistory } from "@/lib/staking/turn-history-reads";
import { withAddress } from "@/lib/staking/operator-cells";

import { useSession } from "../ConsoleProvider";
import { focusHeading } from "../monkey/Card";
import { Row } from "../monkey/Row";
import { ReadNote } from "../monkey/ReadNote";
import { NOTE } from "../monkey/styles";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { SetCard } from "./RotationSets";
import { Reassignments, TurnHistoryCard } from "./TurnRecords";
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
  const signer = rotation?.signer ?? null;
  // Before a first read lands the cards say they are reading; a node that cannot give the rotation says so instead.
  const unread = route.status === "loading" ? "Reading the node's rotation…" : "The node's rotation is not read.";
  const rotationOn = list.value?.rotationEnabled ?? route.value?.rotation_enabled ?? null;
  return (
    <div className={`mt-4 ${trusted ? "grid" : "hidden"} gap-4`}>
      <dl className="grid gap-x-8 gap-y-2 rounded-xl border border-line-2 bg-ink-1 p-4 sm:grid-cols-2">
        <Row label="Rotation">{rotationOn === null ? "—" : rotationOn ? "On" : "Off"}</Row>
        <Row label="Signer the vault names">{signer === null ? "—" : <span title={signer.address}>{shortHex(signer.address)}, epoch {signer.epoch}</span>}</Row>
        <Row label="Today's turn" reserve={TURN_RESERVE}>{rotation === null ? "—" : turnLine(rotation.turn, nameOf, "No turn is in effect")}</Row>
        <Row label="Tomorrow's turn" reserve={TURN_RESERVE}>{rotation === null ? "—" : turnLine(rotation.nextTurn, nameOf, "Not drawn yet")}</Row>
      </dl>
      <ReadNote read={route} loading="Reading the node's rotation…" quiet />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <SetCard id="rotation-set-title" title="Set in effect" set={rotation?.set ?? null} empty={rotation === null ? unread : "No rotation set is in effect."} nowMs={nowMs} nameOf={labelOf} needsUpdate={needsUpdate} />
        <SetCard id="rotation-next-title" title="Next set" set={rotation?.nextSet ?? null} empty={rotation === null ? unread : "No later set has been mirrored."} nowMs={nowMs} nameOf={labelOf} needsUpdate={needsUpdate} />
      </div>
      {/* Both cards are there from the first paint, each in a viewport of one height, so nothing moves when the first read lands. */}
      <Reassignments records={history?.records ?? []} empty={rotation === null ? unread : "No turn among those read was skipped, promoted or refused."} nameOf={labelOf} />
      <TurnHistoryCard
        records={history?.records ?? []} empty={rotation === null ? unread : "No turn has been assigned yet."} more={history === null ? null : history.next !== null} truncated={history?.truncated ?? false} reading={pages.reading} error={pages.error}
        onMore={() => {
          if (rotation === null) return;
          // The last page removes the button that has focus: focus goes to the card's heading, as on the other history cards.
          void turns.loadOlder(rotation.history).then(() => { if (joinHistory(rotation.history, turns.getSnapshot().older).next === null) focusHeading("rotation-history-title"); });
        }}
        nameOf={labelOf}
      />
      <p className={NOTE}>Each set is the members the registry&apos;s election close adopted into the operator schedule, weighted by the stake delegated to each then. A member&apos;s expected share of turns is its weight over the set&apos;s, the odds of each day&apos;s draw. The turn changes at 22:30 UTC; the console moves to the new member&apos;s node once it verifies.</p>
    </div>
  );
}
