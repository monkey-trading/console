/** Tests for the emissions card's boost line: the share the account's volume tier adds to its emission weight, from V68. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixedFromInt } from "@/lib/fixed";
import type { AccountModel } from "@/lib/models";
import type { ConsoleState } from "@/lib/store/state";
import { decodeVolume } from "@/lib/volume-tier";

import { MonkeyPanel } from "@/lib/monkey/panel";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { MonkeyPanelProvider } from "./monkey/use-monkey";
import { EmissionsCard } from "./EmissionsCard";

const WALLET = { address: "0xabc", label: "w" };
const volume = (extra: object) => decodeVolume({ tier: 2, matured: "0", pending: "0", progress: [], best_price_bounds: {}, ...extra });
const account = (v: ReturnType<typeof volume>): AccountModel => ({
  balance: fixedFromInt(1_000), unfinalised: 0n, equity: fixedFromInt(1_000), margin: 0n, positions: [], orders: [], ...(v === null ? {} : { volume: v }),
});

/** The console's state as `patch` sets it, with a MONKEY panel that has read nothing. */
function Page({ patch }: { patch: Partial<ConsoleState> }) {
  const { store } = useSession();
  store.patch(patch);
  return createElement(MonkeyPanelProvider, { value: new MonkeyPanel(store, "staking") }, createElement(EmissionsCard, { claim: async () => undefined, pending: { kind: "none" } }));
}

const render = (patch: Partial<ConsoleState>) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Page, { patch })));

describe("EmissionsCard's boost", () => {
  it("names the multiple the account's tier weighs its emission weight, and the tier", () => {
    expect(render({ wallet: WALLET, accountRead: true, account: account(volume({ emissions_boost_bps: 2_500 })) })).toContain("1.25x your share, from volume tier 2");
    expect(render({ wallet: WALLET, accountRead: true, account: account(volume({ emissions_boost_bps: 0 })) })).toContain("1x your share, from volume tier 2");
  });

  it("holds the line with a dash while the account is read, and shows none from a node that does not serve it or with no wallet", () => {
    expect(render({ wallet: WALLET, accountRead: false, account: null })).toMatch(/Reward boost<\/span><span[^>]*>—</);
    expect(render({ wallet: WALLET, accountRead: true, account: account(volume({})) })).not.toContain("Reward boost");
    // While the page load's wallet connects the line holds its place; once it has settled with none, there is no line.
    expect(render({ wallet: null, walletDecided: false, accountRead: false, account: null })).toMatch(/Reward boost<\/span><span[^>]*>—</);
    expect(render({ wallet: null, walletDecided: true, account: null })).not.toContain("Reward boost");
  });
});
