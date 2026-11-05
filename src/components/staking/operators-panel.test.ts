/**
 * Tests for the operators card rebuilt around the operator table (monkey-trading/console#309): the
 * Delegate tab's editing context comes from the section, so the card renders from the reads and the
 * context alone; the last list verified is labelled with when, at which block and why while the
 * node is down or unverified, its rows still delegate and move, "Delegate to an address" takes a
 * typed address the chain alone checks, and the settle rules keep the row's controls shut.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "@/lib/format";
import { DEMO_ADDRESS } from "@/lib/mock/demo";
import { LOADING, ready } from "@/lib/monkey/figures";
import { OperatorReads, type OperatorsState } from "@/lib/monkey/operators";
import type { MonkeyPanel } from "@/lib/monkey/panel";
import { setup } from "@/lib/monkey/panel-kit";
import { DelegationReads, type DelegationsState } from "@/lib/staking/delegation-reads";
import { amountKey, NO_EDITING, type DelegateEditing } from "@/lib/staking/delegation-form";
import { EpochReads } from "@/lib/staking/epoch-reads";
import { DistributionHistoryReads } from "@/lib/staking/history-reads";
import { operatorsView } from "@/lib/staking/operator-table";
import type { ConsoleState } from "@/lib/store/state";
import { formatStamp } from "@/lib/time";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { StakingContext, type StakingReads } from "../StakingSection";
import { OperatorsPanel } from "./OperatorsPanel";

const WALLET = { address: DEMO_ADDRESS, label: "Browser wallet" };
const ALPHA = "0x00000000000000000000000000000000000000a1";
const BRAVO = "0x00000000000000000000000000000000000000b2";
const RELEASE = `0x${"ab".repeat(32)}`;
const VERIFIED_AT = 1_793_000_000_000;
const HELD_LINE = `From the operator list last verified at ${formatStamp(VERIFIED_AT)} UTC, as the registry stood at final block 4,321:`;

/** A list the node once served: two candidates, read at block 4,321. */
const view = operatorsView({
  block: { number: 4_321, hash: `0x${"cd".repeat(32)}`, time_ms: VERIFIED_AT }, registry: ALPHA, lens: ALPHA, rotation_enabled: true,
  parameters: { epoch_length_secs: 60, min_term_secs: 0, finality_margin_secs: 60, margin_bps: 1_000, eligibility_bps: 500, quorum_bps: 2_000, max_candidates: 100, min_self_bond: "1", liveness_timeout_secs: 60 },
  open_epoch: 1, open_epoch_start_ms: 0, total_staked: "1000", operator_in_effect: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 },
  named_operator: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 }, pending_election: null, pending_promotion: false,
  candidates: [ALPHA, BRAVO].map((address, registration) => ({ address, admin_key: address, enclave: address, self_bond: "1", release: RELEASE, registration, api_hostname: registration === 0 ? "alpha.example" : "bravo.example", handover_endpoint: "", votes: "0", eligible: true, role: registration === 0 ? "operator" as const : "candidate" as const })),
});

const VERIFIED: Partial<ConsoleState> = { wallet: WALLET, walletDecided: true, attestation: { kind: "mock" }, stream: "live" };
const UNVERIFIED: Partial<ConsoleState> = { ...VERIFIED, attestation: { kind: "unverified", reason: "the node's quote did not verify" } };
const chain = (settling = false): DelegationsState => ({
  account: WALLET.address,
  read: ready({ staked: 1_000n * MONKEY_UNIT, delegated: 300n * MONKEY_UNIT, delegations: [{ candidate: ALPHA, amount: 300n * MONKEY_UNIT }] }),
  settling,
});

/** An operators read that serves `state` without asking the node, for the render alone. */
const operatorsLike = (state: OperatorsState): OperatorReads =>
  Object.assign(Object.create(OperatorReads.prototype) as OperatorReads, { getSnapshot: () => state, subscribe: () => () => undefined });

/** A delegation read that serves `state` without asking the wallet. */
const delegationsLike = (state: DelegationsState): DelegationReads =>
  Object.assign(Object.create(DelegationReads.prototype) as DelegationReads, { getSnapshot: () => state, subscribe: () => () => undefined });

/** The panel the AmountForms in open editors need. */
let panel: MonkeyPanel;
let stopPanel = () => {};
beforeAll(async () => {
  const kit = await setup();
  panel = kit.panel;
  stopPanel = kit.stop;
});
afterAll(() => stopPanel());

interface Shown {
  state: Partial<ConsoleState>;
  operators: OperatorsState;
  read: DelegationsState;
  editing?: DelegateEditing;
}

/** The operators card over a session patched to `state`, with the reads and the section's editing context stood in. */
function Block({ state, operators, read, editing = NO_EDITING }: Shown) {
  const { store } = useSession();
  store.patch(state);
  const operatorsReads = operatorsLike(operators);
  const delegationReads = delegationsLike(read);
  const reads: StakingReads = {
    panel, operators: operatorsReads, epochs: new EpochReads(store), delegations: delegationReads, history: new DistributionHistoryReads(store),
    operatorsSettled: true, delegateEditing: editing, setDelegateEditing: () => undefined,
  };
  return createElement(StakingContext.Provider, { value: reads },
    createElement(MonkeyPanelProvider, { value: panel }, createElement(OperatorsPanel, { operators: operatorsReads, delegations: delegationReads })));
}

const render = (shown: Shown) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Block, shown)));

describe("the operators card on the Delegate tab", () => {
  it("shows the table with the search, the All and Yours counts, the sort and the registry's final block, and no typed-address way", () => {
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: chain() });
    expect(html).toContain("As the registry stood at final block 4,321");
    expect(html.match(/>All 2</g)).toHaveLength(1);
    expect(html.match(/>Yours 1</g)).toHaveLength(1);
    expect(html).toContain("Showing 1–2 of 2 operators.");
    expect(html).toContain("Search operators");
    expect(html).toContain("Sort by");
    expect(html).not.toContain("Delegate to an address");
    expect(html).not.toContain("last verified");
    // The account's delegation shows on its row and in the Yours count.
    expect(html).toContain("300 MONKEY");
  });

  it("renders an open editor from the section's editing context, with its preview's words", () => {
    const editing: DelegateEditing = { ...NO_EDITING, editing: { candidate: ALPHA, mode: "delegate" }, amounts: { [amountKey("delegate", ALPHA)]: "10" } };
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: chain(), editing });
    expect(html).toContain("Undelegated 700 MONKEY → 690 MONKEY. Your delegation to alpha.example (0x000000…00a1) 300 MONKEY → 310 MONKEY.");
  });

  it("while the node is unverified, names the last list verified, with when, at which block and why, and keeps the rows' Delegate and Move", () => {
    const html = render({ state: UNVERIFIED, operators: { route: LOADING, list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } }, read: chain() });
    expect(html).toContain(`${HELD_LINE} the node is not verified now.`);
    expect(html.match(/Delegate<span class="sr-only"> to /g)).toHaveLength(4);
    expect(html.match(/Move<span class="sr-only"> part of your delegation to alpha/g)).toHaveLength(2);
    expect(html).toContain("Delegate to an address");
  });

  it("blames the device clock, not the node, when the two disagree", () => {
    const state = { ...UNVERIFIED, attestation: { kind: "clock" as const, skewMs: 90_000 } };
    const html = render({ state, operators: { route: LOADING, list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } }, read: chain() });
    expect(html).toContain(`${HELD_LINE} your device clock differs from the node&#x27;s signed time.`);
  });

  it("with no list held, offers the typed address alone, refused when it fails its checksum or is the zero address", () => {
    const mixed = "0x52908400098527886E0F7030069857D2E4169EE7";
    const base = { state: UNVERIFIED, operators: { route: LOADING, list: LOADING, held: null } as OperatorsState, read: chain() };
    expect(render(base)).toContain("Delegate to an address");
    const field = (typedTo: string) => render({ ...base, editing: { ...NO_EDITING, typedOpen: true, typedTo } });
    expect(field("")).toContain("A candidate&#x27;s address");
    expect(field(mixed.replace("E7", "e7"))).toContain("Enter a candidate&#x27;s 0x address of 40 hexadecimal digits, as its checksum has it.");
    expect(field("0x0000000000000000000000000000000000000000")).toContain("Enter a candidate&#x27;s 0x address");
    expect(field(mixed)).not.toContain("Enter a candidate&#x27;s 0x address");
  });

  it("shuts the rows' controls while a landed change's read again is on its way", () => {
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: chain(true) });
    expect(html.match(/aria-disabled="true"[^>]*>Delegate/g)).toHaveLength(4);
    expect(html.match(/aria-disabled="true"[^>]*>Move/g)).toHaveLength(2);
  });

  it("says so, and offers nothing to send, when the build names no staking contract", () => {
    const unavailable: DelegationsState = { account: WALLET.address, read: { status: "unavailable", value: null, message: null }, settling: false };
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: unavailable });
    expect(html).toContain("This build names no staking contract, so delegation is not available here.");
    expect(html).not.toContain("Delegate<span class=\"sr-only\"> to ");
    expect(html).not.toContain("Delegate to an address");
  });

  it("tells the visitor to connect a wallet, and offers nothing to send for a read-only account", () => {
    const visitor = render({ state: { ...VERIFIED, wallet: null }, operators: { route: LOADING, list: ready(view), held: null }, read: { account: null, read: LOADING, settling: false } });
    expect(visitor).toContain("Connect a wallet to delegate your stake.");
    expect(visitor).not.toContain("Delegate<span class=\"sr-only\"> to ");
    const readOnly = render({ state: { ...VERIFIED, wallet: { ...WALLET, readOnly: true } }, operators: { route: LOADING, list: ready(view), held: null }, read: { account: null, read: { status: "unavailable", value: null, message: null }, settling: false } });
    expect(readOnly).toContain("This account is read-only, so its delegations are not read and nothing can be delegated for it.");
  });
});
