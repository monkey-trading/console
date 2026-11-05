"use client";

/** The Staking section's Delegate tab, its default route: the account's stake with its unstake preview, and the operators its stake is delegated to. */

import { useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";

import { StakePanel } from "../monkey/StakePanel";
import { useConsoleSelect } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { OperatorsPanel } from "./OperatorsPanel";
import { useOperatorLabel } from "./use-operator-label";

/** The Delegate tab: Your stake beside the operators card, which holds the account's delegations and the operator table. */
export function StakingDelegate() {
  const { operators, delegations, operatorsSettled } = useStaking();
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  const delegationsRead = useSyncExternalStore(delegations.subscribe, delegations.getSnapshot, delegations.getSnapshot);
  const wallet = useConsoleSelect((state) => state.wallet);
  const labelOf = useOperatorLabel(operators);
  return (
    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      {/* The figures are hidden, not unmounted, while the node is not trusted: a typed amount survives a gap in the feed, and no figure from before it shows. */}
      <div className={trusted ? "min-w-0" : "hidden"}>
        <StakePanel delegations={wallet !== null && delegationsRead.account === wallet.address ? delegationsRead : null} labelOf={labelOf} />
      </div>
      {/* The operators card shows from the node's first verdict and stays through a re-verification, so what it holds is never taken away mid-way; its grid place is pinned so hiding Your stake never moves it. */}
      <div className={operatorsSettled ? "min-w-0 lg:col-start-2" : "hidden"}>
        <OperatorsPanel operators={operators} delegations={delegations} />
      </div>
    </div>
  );
}
