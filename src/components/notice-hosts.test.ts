/** Renders the screens that host a surface with a message on it, so a screen that stops rendering its surface fails here, not in front of a trader. */

import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatorReads } from "@/lib/monkey/operators";
import { DelegationReads } from "@/lib/staking/delegation-reads";
import { MonkeyPanel } from "@/lib/monkey/panel";
import type { NoticeSurface } from "@/lib/store/state";

import { AccountSummary } from "./AccountSummary";
import { BottomPanel } from "./BottomPanel";
import { ChartPanel } from "./ChartPanel";
import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { DealTicket } from "./DealTicket";
import { DepositForm } from "./DepositForm";
import { EmissionsCard } from "./EmissionsCard";
import { ExitPanel } from "./ExitPanel";
import { MonkeyPanelProvider } from "./monkey/use-monkey";
import { DistributionClaim } from "./monkey/DistributionClaim";
import { OrdersView } from "./OrdersView";
import { Payouts } from "./Payouts";
import { PositionsView } from "./PositionsView";
import { SessionsCard } from "./SessionsCard";
import { SetupSteps } from "./SetupSteps";
import { Shell } from "./Shell";
import { OperatorsPanel } from "./staking/OperatorsPanel";
import { WithdrawForm } from "./WithdrawForm";

const TEXT = "a message the trader must read";

/** Puts a message on `surface` as the page first renders, so the screens after it find it in the store. */
function Seed({ surface, tone, stale }: { surface: NoticeSurface; tone: "error" | "info"; stale?: boolean }) {
  const { store } = useSession();
  store.notify(surface, TEXT, tone);
  if (stale) store.patch({ stream: "stale" });
  return null;
}

/** Panels of the MONKEY and Staking pages, which read the pages' own store. */
function OnMonkeyPage({ children }: { children: ReactNode }) {
  const { store } = useSession();
  return createElement(MonkeyPanelProvider, { value: new MonkeyPanel(store, "staking") }, children);
}

/** The Staking page's operators, over reads that have not started. */
function Operators() {
  const { store } = useSession();
  return createElement(OperatorsPanel, { operators: new OperatorReads(store), delegations: new DelegationReads(store) });
}

function render(surface: NoticeSurface, screen: ReactNode, tone: "error" | "info" = "error", stale = false): string {
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { surface, tone, stale }), screen));
}

const el = <P extends object>(component: ComponentType<P>, props?: P): ReactNode => createElement(component as ComponentType<object>, props ?? null);

/** Each screen that must show a surface, for both tones. Surfaces left out are behind a state a first render does not reach, and are covered where they are raised. */
const HOSTS: readonly [NoticeSurface, string, ReactNode][] = [
  ["ticket", "the deal ticket", el(DealTicket)],
  ["orders", "the orders tab", el(OrdersView)],
  ["positions", "the positions tab", el(PositionsView)],
  ["accountRead", "the account panels on Trade", el(BottomPanel)],
  ["accountRead", "the account strip on Funding", el(AccountSummary)],
  ["deposit", "the Funding deposit form", el(DepositForm)],
  ["setup", "the setup popup's deposit form", el(DepositForm, { embedded: true })],
  ["withdraw", "the withdraw form", el(WithdrawForm)],
  ["setup", "the declaration step", el(SetupSteps, { step: "declare" })],
  ["setup", "the authorize step", el(SetupSteps, { step: "authorize" })],
  ["setup", "the faucet step", el(SetupSteps, { step: "fund" })],
  ["payouts", "the claims on the vault", el(Payouts)],
  ["exit", "the exit panel", el(ExitPanel)],
  ["payoutReads", "the claims on the vault", el(Payouts)],
  ["payoutVault", "the claims on the vault", el(Payouts)],
  ["emissions", "the MONKEY emissions card", createElement(OnMonkeyPage, null, createElement(EmissionsCard, { claim: () => Promise.resolve() }))],
  ["distribution", "the distribution claim", createElement(OnMonkeyPage, null, el(DistributionClaim))],
  ["operator", "the Staking page's operators", createElement(OnMonkeyPage, null, el(Operators))],
  ["settings", "Settings' sessions", el(SessionsCard)],
  ["chart", "the chart", el(ChartPanel)],
  ["wallet", "the top bar", el(Shell)],
  ["account", "the row under the banner", el(Shell)],
  ["node", "the row under the banner", el(Shell)],
];

describe("screens that host a surface", () => {
  it.each(HOSTS)("%s shows on %s", (surface, _screen, screen) => {
    const failure = render(surface, screen, "error");
    expect(failure).toContain(TEXT);
    expect(failure).toMatch(new RegExp(`role="alert"[^>]*>(?:(?!</div>).)*${TEXT}`));
    const status = render(surface, screen, "info");
    expect(status).toMatch(new RegExp(`role="status"[^>]*>(?:(?!</div>).)*${TEXT}`));
  });

  it("shows the feed's last problem in the stale-feed banner", () => {
    expect(render("feed", el(Shell), "error", true)).toContain(TEXT);
  });
});
