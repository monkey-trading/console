/**
 * Tests that the Staking page's unstake waits for a fresh read of the chain's delegations, so the
 * reductions it previews are never ones from before the last transaction (monkey-trading/console#279).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StakeDelegations } from "@/lib/engine/staking";
import { MONKEY_UNIT } from "@/lib/format";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { failed, LOADING, ready, type Read } from "@/lib/monkey/figures";
import type { MonkeyPanel } from "@/lib/monkey/panel";
import { setup } from "@/lib/monkey/panel-kit";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { StakePanel } from "./StakePanel";
import { MonkeyPanelProvider } from "./use-monkey";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const CANDIDATE = "0x00000000000000000000000000000000000000a1";

/** The stake card for the demo wallet, with `panel`'s figures and the chain's delegations as given. */
function Card({ panel, delegations }: { panel: MonkeyPanel; delegations: { read: Read<StakeDelegations>; settling: boolean } }) {
  const { store } = useSession();
  store.patch({ wallet: { address: DEMO_ADDRESS, label: "Browser wallet" }, walletDecided: true });
  return createElement(MonkeyPanelProvider, { value: panel }, createElement(StakePanel, { delegations, labelOf: () => "alpha.example" }));
}

/** The Start unstake button's markup, which says whether it can be pressed. */
const unstakeButton = (html: string) => /<button[^>]*>Start unstake<\/button>/.exec(html)?.[0] ?? "";

describe("the Staking page's unstake", () => {
  it("opens only on delegations read since the last landed change, previews what it takes from them, and says why a read failed", async () => {
    const { panel, stop } = await setup();
    const staked = panel.getSnapshot().wallet.position.value?.staked ?? 0n;
    expect(staked).toBeGreaterThan(MONKEY_UNIT);
    panel.setDraft("unstake", "1");
    const chain: StakeDelegations = { staked, delegated: staked, delegations: [{ candidate: CANDIDATE, amount: staked }] };
    const render = (read: Read<StakeDelegations>, settling = false) =>
      renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Card, { panel, delegations: { read, settling } })));

    const fresh = render(ready(chain));
    expect(unstakeButton(fresh)).toContain('aria-disabled="false"');
    expect(fresh).toContain("This takes 1 MONKEY from your delegation to alpha.example (0x000000…00a1).");
    // The stake's split as the chain tells it: all of it delegated to one candidate, none abstaining.
    expect(fresh).toContain("12,000 MONKEY to 1");
    expect(fresh).toContain("0 MONKEY (abstains)");
    // A landed change whose read again has not: the delegations held may be the ones before it.
    const settling = render(ready(chain), true);
    expect(unstakeButton(settling)).toContain('aria-disabled="true"');
    expect(settling).not.toContain("This takes");
    expect(unstakeButton(render(LOADING))).toContain('aria-disabled="true"');
    // A later read that failed keeps the figures it had, which no landed change has outdated, and says why.
    const broken = render(failed(new Error("your wallet is on chain 1, not chain 31337"), chain));
    expect(unstakeButton(broken)).toContain('aria-disabled="false"');
    expect(broken).toContain("your wallet is on chain 1, not chain 31337");
    expect(unstakeButton(render(failed<StakeDelegations>(new Error("your wallet is on chain 1, not chain 31337"), null)))).toContain('aria-disabled="true"');
    stop();
  });
});
