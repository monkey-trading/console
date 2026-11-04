/**
 * Tests that the MONKEY and Staking pages' cards hold their loaded layout while their first reads
 * run, so nothing below them moves when a read lands (monkey-trading/console#286), and that each
 * shows its no-wallet line once the page load has settled that no wallet connects.
 */

import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MonkeyPanel } from "@/lib/monkey/panel";
import type { PanelPage } from "@/lib/monkey/panel-state";
import type { ConsoleState } from "@/lib/store/state";

import { EmissionsCard } from "../EmissionsCard";
import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { ActivityTable } from "./ActivityTable";
import { ChartCard } from "./ChartCard";
import { DistributionClaim } from "./DistributionClaim";
import { DistributionPanel } from "./DistributionPanel";
import { StakePanel } from "./StakePanel";
import { TokenPanel } from "./TokenPanel";
import { MonkeyPanelProvider } from "./use-monkey";

const WALLET = { address: "0x00000000000000000000000000000000000000aa", label: "Browser wallet" };

/** The console's state as `state` sets it, with a panel for `page` that has read nothing yet. */
function Page({ state, page, children }: { state: Partial<ConsoleState>; page: PanelPage; children?: ReactNode }) {
  const { store } = useSession();
  store.patch(state);
  return createElement(MonkeyPanelProvider, { value: new MonkeyPanel(store, page) }, children);
}

function render(card: ComponentType, state: Partial<ConsoleState>, page: PanelPage = "staking"): string {
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Page, { state, page }, createElement(card))));
}

const Emissions = () => createElement(EmissionsCard, { claim: async () => undefined, pending: { kind: "reading" } });
const Chart = () => {
  const { store } = useSession();
  return createElement(ChartCard, { id: "chart", title: "Chart", feed: new MonkeyPanel(store, "staking").feed("epochs"), kind: "bars", lines: [{ metric: "distributed_per_epoch", label: "USDC distributed", tone: "glow" }], format: String });
};

/** How many elements the markup holds unseen and hidden from assistive technology: a held place. */
const held = (html: string) => (html.match(/aria-hidden="true" class="[^"]*\binvisible\b/g) ?? []).length;

describe("the cards while the page load's wallet is not settled", () => {
  const unsettled = { wallet: null, walletDecided: false };

  it("holds the stake card's rows and forms with dashes, and says no wallet is connected only once settled", () => {
    const html = render(StakePanel, unsettled);
    for (const text of ["Staked", "Wallet balance", "Share of all stake", "Start unstake", "Reading your stake…", "—"]) expect(html, text).toContain(text);
    expect(html).not.toContain("Connect a wallet");
    const settled = render(StakePanel, { wallet: null, walletDecided: true });
    expect(settled).toContain("Connect a wallet to stake or unstake MONKEY.");
    expect(settled).not.toContain("Start unstake");
  });

  it("holds the distribution claim's rows and its button's place", () => {
    const html = render(DistributionClaim, unsettled);
    for (const text of ["Distributed to you", "Paid by the vault", "Claimable", "Reading your distributions…"]) expect(html, text).toContain(text);
    expect(held(html)).toBe(1);
    expect(render(DistributionClaim, { wallet: null, walletDecided: true })).toContain("Connect a wallet to see your USDC distributions.");
  });

  it("holds the emissions card's row and its button's place", () => {
    const html = render(Emissions, unsettled, "monkey");
    expect(html).toContain("Reading your MONKEY emissions…");
    expect(held(html)).toBe(1);
    expect(render(Emissions, { wallet: null, walletDecided: true }, "monkey")).toContain("Connect a wallet to see your MONKEY emissions.");
  });
});

describe("the cards while a connected wallet's first reads run", () => {
  it("holds the stake card's layout until the stake is read", () => {
    const html = render(StakePanel, { wallet: WALLET, walletDecided: true });
    expect(html).toContain("Start unstake");
    expect(html).toContain("Reading your stake…");
  });

  it("holds the emissions card's layout while the account or its closed periods are read", () => {
    expect(render(Emissions, { wallet: WALLET, walletDecided: true, accountRead: false }, "monkey")).toContain("Reading your MONKEY emissions…");
    const periods = render(Emissions, { wallet: WALLET, walletDecided: true, accountRead: true, entitlement: null }, "monkey");
    expect(periods).toContain("Reading your MONKEY emissions…");
    expect(held(periods)).toBe(1);
  });
});

describe("the cards while the node's totals are read", () => {
  it("holds the activity table's head, a reading row and the rows it will hold, unseen", () => {
    const html = render(ActivityTable, {}, "monkey");
    expect(html).toContain("Reading the latest activity…");
    expect(html).toContain(">Time<");
    expect(held(html)).toBe(24);
  });

  it("holds the distribution card's rows with dashes, and keeps the token card's reading line for screen readers alone", () => {
    const distribution = render(DistributionPanel, {});
    for (const text of ["Excess above the floor now", "Liquidity floor", "Last distribution", "Next close"]) expect(distribution, text).toContain(text);
    expect(render(TokenPanel, {}, "monkey")).toMatch(/<p class="sr-only">Reading the node&#x27;s figures…<\/p>/);
  });

  it("holds a chart card's lines below the chart while its data is read", () => {
    const html = render(Chart, {});
    expect(html).toContain("Reading the chart&#x27;s data…");
    expect(html).toMatch(/aria-hidden="true" class="invisible"/);
  });
});
