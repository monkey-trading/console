"use client";

/** The Staking section's Delegate tab, its default route: the account's stake with its unstake preview on top, and the operator table with the account's delegations directly below it (monkey-trading/console#309). */

import { useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";

import { StakePanel } from "../monkey/StakePanel";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { OperatorsPanel } from "./OperatorsPanel";
import { useOperatorLabel } from "./use-operator-label";

/** The Delegate tab: Your stake on top, the operators card with the per-row delegation editors directly below. */
export function StakingDelegate() {
  const { operators, delegations, operatorsSettled } = useStaking();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const delegationsRead = useSyncExternalStore(delegations.subscribe, delegations.getSnapshot, delegations.getSnapshot);
  const wallet = useConsoleSelect((state) => state.wallet);
  const labelOf = useOperatorLabel(operators);
  return (
    <div className="mt-4 space-y-4">
      {/* The figures keep their box while the node is not trusted — invisible and inert, not unmounted — so a typed amount survives a gap in the feed, no figure from before it shows, and the operators card below never moves. */}
      <div className={trusted ? "min-w-0" : "invisible"} inert={!trusted}>
        <StakePanel delegations={wallet !== null && delegationsRead.account === wallet.address ? delegationsRead : null} labelOf={labelOf} />
      </div>
      {/* The operators card shows from the node's first verdict and stays through a re-verification, so what it holds is never taken away mid-way. */}
      <div className={operatorsSettled ? "min-w-0" : "hidden"}>
        <OperatorsPanel operators={operators} delegations={delegations} />
      </div>
    </div>
  );
}
