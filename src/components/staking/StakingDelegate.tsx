"use client";

/** The Staking section's Delegate tab, its default route: the account's stake with its unstake preview on top, and the operator table with the account's delegations directly below it (monkey-trading/console#309). */

import { useEffect, useRef, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";

import { StakePanel } from "../monkey/StakePanel";
import { useConsoleSelect, usePanelState } from "../monkey/use-monkey";
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
  const { wallet: figures } = usePanelState();
  const card = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const reading = wallet !== null && (figures.address !== wallet.address || figures.position.value === null);
  useEffect(() => {
    const outer = card.current;
    const inner = content.current;
    if (!trusted || reading || outer === null || inner === null) return;
    const measure = () => { outer.style.minHeight = `${inner.getBoundingClientRect().height}px`; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [trusted, reading]);
  return (
    <div className="mt-4 space-y-4">
      {/* Keep the loaded height, including a cooldown, until the replacement wallet read settles. */}
      <div ref={card} className={trusted ? "min-w-0" : "invisible"} inert={!trusted}>
        <div ref={content}>
          <StakePanel delegations={wallet !== null && delegationsRead.account === wallet.address ? delegationsRead : null} labelOf={labelOf} />
        </div>
      </div>
      {/* The operators card shows from the node's first verdict and stays through a re-verification, so what it holds is never taken away mid-way. */}
      <div className={operatorsSettled ? "min-w-0" : "hidden"}>
        <OperatorsPanel operators={operators} delegations={delegations} />
      </div>
    </div>
  );
}
