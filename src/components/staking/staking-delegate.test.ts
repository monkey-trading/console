/**
 * Tests that the Delegate tab shows its operators card only once the account's own reads have
 * answered, so the stake card growing above it when they land — a cooldown, a wrapped split — moves
 * nothing already painted (monkey-trading/console#328), whichever of the list and the wallet reads
 * answers first.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "@/lib/format";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { LOADING, ready } from "@/lib/monkey/figures";
import { OperatorReads, type OperatorsState } from "@/lib/monkey/operators";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { setup } from "@/lib/monkey/panel-kit";
import { DelegationReads, type DelegationsState } from "@/lib/staking/delegation-reads";
import { NO_EDITING } from "@/lib/staking/delegation-form";
import { EpochReads } from "@/lib/staking/epoch-reads";
import { GovernanceReads } from "@/lib/staking/governance-reads";
import { DistributionHistoryReads } from "@/lib/staking/history-reads";
import { MemberVoteReads } from "@/lib/staking/member-vote-reads";
import { NO_TABLE_VIEW } from "@/lib/staking/operator-table";
import type { ConsoleState } from "@/lib/store/state";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { StakingContext, type StakingReads } from "../StakingSection";
import { StakingDelegate } from "./StakingDelegate";

const WALLET = { address: DEMO_ADDRESS, label: "Browser wallet" };
const VERIFIED: Partial<ConsoleState> = { wallet: WALLET, walletDecided: true, attestation: { kind: "mock" }, stream: "live" };
const chain = (status: "ready" | "loading", account: string | null = WALLET.address): DelegationsState => ({
  account,
  read: status === "ready" ? ready({ staked: 1_000n * MONKEY_UNIT, delegated: 0n, delegations: [] }) : LOADING,
  settling: false,
});
const operatorsLike = (state: OperatorsState): OperatorReads =>
  Object.assign(Object.create(OperatorReads.prototype) as OperatorReads, { getSnapshot: () => state, subscribe: () => () => undefined });
const delegationsLike = (state: DelegationsState): DelegationReads =>
  Object.assign(Object.create(DelegationReads.prototype) as DelegationReads, { getSnapshot: () => state, subscribe: () => () => undefined });

let loaded: MonkeyPanel;
let stop = () => {};
beforeAll(async () => {
  const kit = await setup();
  loaded = kit.panel;
  stop = kit.stop;
});
afterAll(() => stop());

/** The tab over a panel that has read the position (`read`) or not, and the chain's delegation read as given. */
function Tab({ state, read, delegations }: { state: Partial<ConsoleState>; read: boolean; delegations: DelegationsState }) {
  const { store } = useSession();
  store.patch(state);
  const panel = read ? loaded : new MonkeyPanel(store, "staking");
  const operators = operatorsLike({ route: LOADING, list: LOADING, held: null });
  const delegationReads = delegationsLike(delegations);
  const governance = new GovernanceReads(store);
  const reads: StakingReads = {
    panel, operators, epochs: new EpochReads(store), delegations: delegationReads, history: new DistributionHistoryReads(store),
    governance, memberVotes: new MemberVoteReads(store, operators, governance, delegationReads),
    operatorsSettled: true, delegateEditing: NO_EDITING, setDelegateEditing: () => undefined, table: NO_TABLE_VIEW, setTable: () => undefined,
    typedSlot: false, setTypedSlot: () => undefined,
  };
  return createElement(StakingContext.Provider, { value: reads }, createElement(MonkeyPanelProvider, { value: panel }, createElement(StakingDelegate)));
}

const render = (props: { state?: Partial<ConsoleState>; read: boolean; delegations: DelegationsState }) =>
  renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Tab, { state: VERIFIED, ...props })));
/** The class of the wrapper around the operators card: "hidden" until it shows. */
const operatorsWrapper = (html: string) => /<div class="([^"]*)"><section aria-labelledby="operators-title"/.exec(html)?.[1];

describe("the Delegate tab's operators card", () => {
  it("is not shown while the stake position is still being read, and shows once it has been", () => {
    expect(operatorsWrapper(render({ read: false, delegations: chain("ready") }))).toBe("hidden");
    expect(operatorsWrapper(render({ read: true, delegations: chain("ready") }))).toBe("min-w-0");
  });

  it("is not shown while the account's delegations are still being read, whichever read answered first", () => {
    expect(operatorsWrapper(render({ read: true, delegations: chain("loading") }))).toBe("hidden");
    expect(operatorsWrapper(render({ read: true, delegations: chain("ready", "0x00000000000000000000000000000000000000b2") }))).toBe("hidden");
  });

  it("is shown at once with no wallet connected, and without waiting for a stake position the untrusted node cannot give", () => {
    expect(operatorsWrapper(render({ state: { wallet: null, walletDecided: true, attestation: { kind: "mock" }, stream: "live" }, read: false, delegations: chain("loading", null) }))).toBe("min-w-0");
    const untrusted = { ...VERIFIED, attestation: { kind: "unverified" as const, reason: "the node's quote did not verify" } };
    expect(operatorsWrapper(render({ state: untrusted, read: false, delegations: chain("ready") }))).toBe("min-w-0");
  });
});
