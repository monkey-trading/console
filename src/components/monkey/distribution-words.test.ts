/**
 * Tests that the Staking page's distribution cards say what the node's totals count: every close's
 * allocation, the operator's fifth included while operator rotation is on, which the Distribution
 * card states once (monkey-trading/console#295, monkey-trading/console#299).
 */

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EpochClose } from "@/lib/engine/staking-reads";
import type { MonkeyView } from "@/lib/engine/stats-types";
import { ready } from "@/lib/monkey/figures";
import { MonkeyPanel } from "@/lib/monkey/panel";
import type { EpochReads, EpochsState } from "@/lib/staking/epoch-reads";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { DistributionClaim } from "./DistributionClaim";
import { DistributionPanel } from "./DistributionPanel";
import { RewardsPanel } from "./RewardsPanel";
import { MonkeyPanelProvider } from "./use-monkey";

const view = {
  time_ms: 1_000, staking: { total_staked: "1000", stakers: 1, cooldown_ms: 1 },
  distribution: {
    start_ms: 0, epoch_ms: 300_000, liquidity_floor: "100", nav: "200", excess_usd: "100", excess_seq: 1, epoch: 3, last_closed_epoch: 2, last_closed_ms: 500,
    next_close_ms: 900_000, distributed_usdc_units: "100000000", last_distribution: null,
  },
} as unknown as MonkeyView;

const ME = "0x00000000000000000000000000000000000000aa";
const UNIT = 10n ** 18n;

/** The card, over a panel whose node answer is `overview` and whose wallet, `ME`, stakes a quarter of the total and has no proof yet. */
function Page({ card, overview = view }: { card: ComponentType; overview?: MonkeyView }) {
  const { store } = useSession();
  store.patch({ wallet: { address: ME, label: "Browser wallet" }, walletDecided: true });
  const panel = new MonkeyPanel(store, "staking");
  const position = ready({ stakingEnabled: true, staked: 250n * UNIT, unstaking: null, balance: 0n, distributionsClaimed: 0n, latestSeq: 0 });
  (panel as unknown as { state: unknown }).state = { ...panel.getSnapshot(), overview: ready(overview), wallet: { address: ME, position, proof: ready(null), record: ready(null) } };
  return createElement(MonkeyPanelProvider, { value: panel }, createElement(card));
}

const render = (card: ComponentType, overview?: MonkeyView) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Page, { card, overview })));

/** The closed epochs as the page reads them: epoch 2 allocated 100 USDC, 80 of it to stakers. */
const closes = (held: EpochClose[]) => {
  const state = { status: "ready", epochs: held, next: null, cover: null, more: false, error: null, moreError: null } as EpochsState;
  return { subscribe: () => () => undefined, getSnapshot: () => state } as unknown as EpochReads;
};
const two = { epoch: 2, stakers_usdc_units: "80000000" } as EpochClose;
const pending = { ...view, staking: { total_staked: (1_000n * UNIT).toString(), stakers: 2, cooldown_ms: 1 }, distribution: { ...view.distribution, last_distribution: { epoch: 2, closed_ms: 900, nav: "0", floor: "0", excess_usdc_units: "100000000", allocated_usdc_units: "100000000" } } } as MonkeyView;

describe("the distribution cards' words", () => {
  it("names the node's total the whole distribution, never the stakers' alone", () => {
    const html = render(RewardsPanel);
    expect(html).toContain("Total distributed");
    expect(html).not.toContain("to stakers");
  });

  it("says what a close awaiting its proof paid stakers, and estimates the share from that, not from the whole allocation", () => {
    const Claim = () => createElement(DistributionClaim, { epochs: closes([two]) });
    const html = render(Claim, pending);
    expect(html).toContain("Epoch 2 closed and paid 80 USDC to stakers.");
    expect(html).toContain("your share is about 20 USDC");
    // Until the closed epochs are read, no amount and no estimate.
    const unread = render(() => createElement(DistributionClaim, { epochs: closes([]) }), pending);
    expect(unread).toContain("Epoch 2 closed and paid stakers.");
    expect(unread).not.toContain("your share is about");
  });

  it("states the split once: a fifth to the operator in effect while rotation is on, the rest between stakers", () => {
    expect(render(DistributionPanel)).toContain("are distributed: while operator rotation is on, a fifth to the operator in effect, and the rest between stakers in proportion to their stake.");
  });
});
