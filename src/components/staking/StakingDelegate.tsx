"use client";

/** The Staking section's Delegate tab, its default route: the account's stake with its unstake preview on top, and the operator table with the account's delegations directly below it (monkey-trading/console#309). */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { readBlock } from "@/lib/engine/attestation";

import { accountReadsSettled } from "@/lib/staking/delegation-reads";

import { StakePanel } from "../monkey/StakePanel";
import { useConsoleSelect, usePanelState } from "../monkey/use-monkey";
import { useStaking } from "../StakingSection";
import { OperatorsPanel } from "./OperatorsPanel";
import { useOperatorLabel } from "./use-operator-label";

/** How long the operators card waits for the account's reads before it shows anyway. */
const ACCOUNT_WAIT_MS = 3_000;

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
  const decided = useConsoleSelect((state) => state.walletDecided);
  const reading = wallet !== null && (figures.address !== wallet.address || figures.position.value === null);
  // The operators card waits for the account's own reads (monkey-trading/console#328): the stake card above it grows when they land — a cooldown, a wrapped split — and nothing painted below may move with it. The chain's delegation read never waits on the node, and the stake card's own, which does, is not waited for while the node is untrusted, so no operator holds a staker's vote away; once shown, the card stays.
  const accountSettled = accountReadsSettled({ wallet, decided, delegations: delegationsRead, position: trusted ? (figures.address === wallet?.address ? figures.position.status : "loading") : "ready" });
  const [accountShown, setAccountShown] = useState(false);
  if (accountSettled && !accountShown) setAccountShown(true);
  // A wallet that never answers does not hold the card back for ever: after the wait it shows, and grows as its reads land.
  useEffect(() => {
    if (accountShown) return;
    const timer = setTimeout(() => setAccountShown(true), ACCOUNT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [accountShown]);
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
      <div className={operatorsSettled && accountShown ? "min-w-0" : "hidden"}>
        <OperatorsPanel operators={operators} delegations={delegations} />
      </div>
    </div>
  );
}
