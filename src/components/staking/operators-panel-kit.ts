/** What the operators card's tests share: a list the node once served, the chain's reads stood in, and the card rendered over them. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MONKEY_UNIT } from "@/lib/format";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { ready } from "@/lib/monkey/figures";
import { OperatorReads, type OperatorsState } from "@/lib/monkey/operators";
import type { MonkeyPanel } from "@/lib/monkey/panel";
import { setup } from "@/lib/monkey/panel-kit";
import { DelegationReads, type DelegationsState } from "@/lib/staking/delegation-reads";
import { NO_EDITING, type DelegateEditing } from "@/lib/staking/delegation-form";
import { EpochReads } from "@/lib/staking/epoch-reads";
import { DistributionHistoryReads } from "@/lib/staking/history-reads";
import { NO_TABLE_VIEW, operatorsView, type TableViewState } from "@/lib/staking/operator-table";
import type { ConsoleState } from "@/lib/store/state";
import { formatStamp } from "@/lib/time";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { StakingContext, type StakingReads } from "../StakingSection";
import { OperatorsPanel } from "./OperatorsPanel";

export const WALLET = { address: DEMO_ADDRESS, label: "Browser wallet" };
export const ALPHA = "0x00000000000000000000000000000000000000a1";
export const BRAVO = "0x00000000000000000000000000000000000000b2";
export const RELEASE = `0x${"ab".repeat(32)}`;
export const VERIFIED_AT = 1_793_000_000_000;
export const HELD_LINE = `From the operator list last verified at ${formatStamp(VERIFIED_AT)} UTC, as the registry stood at final block 4,321:`;

/** A list the node once served: two candidates, read at block 4,321. */
export const view = operatorsView({
  block: { number: 4_321, hash: `0x${"cd".repeat(32)}`, time_ms: VERIFIED_AT }, registry: ALPHA, lens: ALPHA, rotation_enabled: true,
  parameters: { epoch_length_secs: 60, min_term_secs: 0, finality_margin_secs: 60, margin_bps: 1_000, eligibility_bps: 500, quorum_bps: 2_000, max_candidates: 100, min_self_bond: "1", liveness_timeout_secs: 60 },
  open_epoch: 1, open_epoch_start_ms: 0, total_staked: "1000", operator_in_effect: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 },
  named_operator: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 }, pending_election: null, pending_promotion: false,
  candidates: [ALPHA, BRAVO].map((address, registration) => ({ address, admin_key: address, enclave: address, self_bond: "1", release: RELEASE, registration, api_hostname: registration === 0 ? "alpha.example" : "bravo.example", handover_endpoint: "", votes: "0", eligible: true, role: registration === 0 ? "operator" as const : "candidate" as const })),
});

export const VERIFIED: Partial<ConsoleState> = { wallet: WALLET, walletDecided: true, attestation: { kind: "mock" }, stream: "live" };
export const UNVERIFIED: Partial<ConsoleState> = { ...VERIFIED, attestation: { kind: "unverified", reason: "the node's quote did not verify" } };
/** The chain's word on the wallet's stake; `delegations` as given, one delegation to alpha by default. */
export const chain = (settling = false, delegations: { candidate: string; amount: bigint }[] = [{ candidate: ALPHA, amount: 300n * MONKEY_UNIT }]): DelegationsState => ({
  account: WALLET.address,
  read: ready({ staked: 1_000n * MONKEY_UNIT, delegated: delegations.reduce((sum, { amount }) => sum + amount, 0n), delegations }),
  settling,
});

/** An operators read that serves `state` without asking the node, for the render alone. */
export const operatorsLike = (state: OperatorsState): OperatorReads =>
  Object.assign(Object.create(OperatorReads.prototype) as OperatorReads, { getSnapshot: () => state, subscribe: () => () => undefined });

/** A delegation read that serves `state` without asking the wallet. */
export const delegationsLike = (state: DelegationsState): DelegationReads =>
  Object.assign(Object.create(DelegationReads.prototype) as DelegationReads, { getSnapshot: () => state, subscribe: () => () => undefined });

/** The panel the AmountForms in open editors need. */
export let panel: MonkeyPanel;
let stopPanel = () => {};
export async function startPanel(): Promise<void> {
  const kit = await setup();
  panel = kit.panel;
  stopPanel = kit.stop;
}
export function stopPanelKit(): void {
  stopPanel();
}

export interface Shown {
  state: Partial<ConsoleState>;
  operators: OperatorsState;
  read: DelegationsState;
  editing?: DelegateEditing;
  /** The table view the section holds across a tab switch; the home view by default. */
  table?: TableViewState;
  /** Whether the typed-address way was offered earlier on this visit. */
  typedSlot?: boolean;
}

/** The operators card over a session patched to `state`, with the reads and the section's editing context and table view stood in. */
function Block({ state, operators, read, editing = NO_EDITING, table = NO_TABLE_VIEW, typedSlot = false }: Shown) {
  const { store } = useSession();
  store.patch(state);
  const operatorsReads = operatorsLike(operators);
  const delegationReads = delegationsLike(read);
  const reads: StakingReads = {
    panel, operators: operatorsReads, epochs: new EpochReads(store), delegations: delegationReads, history: new DistributionHistoryReads(store),
    operatorsSettled: true, delegateEditing: editing, setDelegateEditing: () => undefined, table, setTable: () => undefined, typedSlot, setTypedSlot: () => undefined,
  };
  return createElement(StakingContext.Provider, { value: reads },
    createElement(MonkeyPanelProvider, { value: panel }, createElement(OperatorsPanel, { operators: operatorsReads, delegations: delegationReads })));
}

export const render = (shown: Shown) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Block, shown)));


