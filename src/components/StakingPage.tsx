"use client";

/**
 * The Staking page (monkey-trading/console#271): the account's stake with its unstake cooldown, its
 * USDC distributions with the claim and their history by epoch, what stakers have been paid, two
 * charts of the distributions, and the operators a stake is delegated to with the account's
 * delegations (#279). Panels on the left and charts on the right where there is room, the operators
 * across the page below; stacked on a phone. Every figure is read only while the page is on screen.
 */

import { useEffect, useState } from "react";

import { formatCompactUsd } from "@/lib/chart-format";
import { readBlock } from "@/lib/engine/attestation";
import { OperatorReads } from "@/lib/monkey/operators";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { EpochReads } from "@/lib/staking/epoch-reads";
import { DistributionHistoryReads } from "@/lib/staking/history-reads";

import { useSession } from "./ConsoleProvider";
import { ChartCard } from "./monkey/ChartCard";
import type { LineSpec } from "./monkey/ChartCanvas";
import { DistributionClaim } from "./monkey/DistributionClaim";
import { DistributionPanel } from "./monkey/DistributionPanel";
import { RewardsPanel } from "./monkey/RewardsPanel";
import { StakePanel } from "./monkey/StakePanel";
import { useOperatorLabel } from "./staking/use-operator-label";
import { MonkeyPanelProvider, useConsoleSelect } from "./monkey/use-monkey";
import { DistributionHistory } from "./staking/DistributionHistory";
import { EpochHistory } from "./staking/EpochHistory";
import { OperatorsPanel } from "./staking/OperatorsPanel";

const EPOCH_LINES: readonly LineSpec[] = [{ metric: "distributed_per_epoch", label: "USDC distributed", tone: "glow" }];
const REWARD_LINES: readonly LineSpec[] = [{ metric: "cumulative_distributed", label: "USDC distributed", tone: "glow" }];

const hidden = () => document.visibilityState === "hidden";

/** The Staking screen; the console's layout supplies the provider, the access gate and the shell. */
export function StakingPage() {
  const { store } = useSession();
  const [panel] = useState(() => new MonkeyPanel(store, "staking"));
  const [operators] = useState(() => new OperatorReads(store));
  const [history] = useState(() => new DistributionHistoryReads(store));
  const [epochs] = useState(() => new EpochReads(store));
  const trusted = useConsoleSelect((state) => readBlock(state.attestation, state.stream) === null);
  // The wallet object changes whenever a wallet connects, even to the same address, and the chain reads follow it.
  const wallet = useConsoleSelect((state) => state.wallet);
  // Reads start once the node's answers can be trusted and stop when the page is left; a gap in the feed restarts them, so what it carried is read again.
  useEffect(() => (trusted ? panel.start(hidden) : undefined), [panel, trusted]);
  useEffect(() => (trusted ? history.start(hidden) : undefined), [history, trusted]);
  useEffect(() => (trusted ? epochs.start(hidden) : undefined), [epochs, trusted]);
  // The operator list is the node's signed answer: its reads follow the node's trust themselves, read the moment it may be read.
  useEffect(() => operators.start(hidden), [operators]);
  useEffect(() => {
    if (trusted) void panel.refreshWallet();
  }, [panel, trusted, wallet]);
  useEffect(() => history.walletChanged(), [history, wallet]);
  const labelOf = useOperatorLabel(operators);
  return (
    <MonkeyPanelProvider value={panel}>
      {/* Keyboard scrolling needs a tab stop on the scroll container, as on the House page. */}
      <div role="region" aria-label="Staking details" tabIndex={0} className="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow">
        <div className="mx-auto w-full max-w-[110rem] px-4 py-5 sm:px-6">
          <h2 className="text-lead tracking-caps text-glow uppercase">Staking</h2>
          {!trusted && <p className="mt-3 text-data leading-relaxed text-fg-2">Figures appear once the node&apos;s attestation is verified and its feed is live.</p>}
          {/* The figures are hidden, not unmounted, while the node is not trusted: a typed amount survives a gap in the feed, and no figure from before it shows. */}
          <div className={`mt-4 ${trusted ? "grid" : "hidden"} items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,35rem)_minmax(0,1fr)]`}>
            <div className="flex min-w-0 flex-col gap-4">
              <StakePanel labelOf={labelOf} />
              <DistributionClaim />
              <DistributionHistory history={history} />
              <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                <RewardsPanel />
                <DistributionPanel />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <ChartCard id="chart-epochs" title="USDC distributed per epoch" caption="What each epoch close shared between stakers." feed={panel.feed("epochs")} kind="bars" lines={EPOCH_LINES} format={formatCompactUsd} />
              <ChartCard id="chart-rewards" title="Total USDC distributed to stakers" caption="Cumulative, across every epoch close." feed={panel.feed("rewards")} kind="area" lines={REWARD_LINES} format={formatCompactUsd} />
              <EpochHistory epochs={epochs} labelOf={labelOf} />
            </div>
          </div>
          {/* The operators card stays, saying what waits on the node, so the page holds its height while the node is verified. */}
          <div className="mt-4">
            <OperatorsPanel operators={operators} />
          </div>
        </div>
      </div>
    </MonkeyPanelProvider>
  );
}
