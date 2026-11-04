/**
 * Tests that the delegations block keeps a staker able to vote away from a node that is down or
 * unverified (monkey-trading/console#279): Take back stays, and Delegate and Move choose from the last
 * list verified, labelled with when, or a typed address the chain alone checks.
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
import { operatorsView } from "@/lib/staking/operator-table";
import type { ConsoleState } from "@/lib/store/state";
import { formatStamp } from "@/lib/time";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { Delegations } from "./Delegations";

const WALLET = { address: DEMO_ADDRESS, label: "Browser wallet" };
const ALPHA = "0x00000000000000000000000000000000000000a1";
const BRAVO = "0x00000000000000000000000000000000000000b2";
const RELEASE = `0x${"ab".repeat(32)}`;
const VERIFIED_AT = 1_793_000_000_000;

/** A list the node once served: two candidates, read at block 4,321. */
const view = operatorsView({
  block: { number: 4_321, hash: `0x${"cd".repeat(32)}`, time_ms: VERIFIED_AT }, registry: ALPHA, lens: ALPHA, rotation_enabled: true,
  parameters: { epoch_length_secs: 60, min_term_secs: 0, finality_margin_secs: 60, margin_bps: 1_000, eligibility_bps: 500, quorum_bps: 2_000, max_candidates: 100, min_self_bond: "1", liveness_timeout_secs: 60 },
  open_epoch: 1, open_epoch_start_ms: 0, total_staked: "1000", operator_in_effect: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 },
  named_operator: { candidate: ALPHA, admin_key: ALPHA, release: RELEASE, since_ms: 0 }, pending_election: null, pending_promotion: false,
  candidates: [ALPHA, BRAVO].map((address, registration) => ({ address, admin_key: address, enclave: address, self_bond: "1", release: RELEASE, registration, api_hostname: registration === 0 ? "alpha.example" : "bravo.example", handover_endpoint: "", votes: "0", eligible: true, role: registration === 0 ? "operator" as const : "candidate" as const })),
});

const UNVERIFIED: Partial<ConsoleState> = { wallet: WALLET, walletDecided: true, attestation: { kind: "unverified", reason: "the node's quote did not verify" } };
const chain = (amounts: [string, bigint][], settling = false): DelegationsState => ({
  account: WALLET.address,
  read: ready({ staked: 1_000n * MONKEY_UNIT, delegated: amounts.reduce((sum, [, amount]) => sum + amount, 0n), delegations: amounts.map(([candidate, amount]) => ({ candidate, amount })) }),
  settling,
});
const labelOf = (address: string) => (address === ALPHA ? "alpha.example" : address === BRAVO ? "bravo.example" : address);

interface Shown { state: Partial<ConsoleState>; lists: Pick<OperatorsState, "list" | "held">; read: DelegationsState; target: string; typedTo: string }

/** The demo wallet's panel on the mock node, with an amount typed, so the Delegate button says only whether a candidate is chosen and the form is open. */
let panel: MonkeyPanel;
let stopPanel = () => {};
beforeAll(async () => {
  const kit = await setup();
  panel = kit.panel;
  stopPanel = kit.stop;
  panel.setDraft("delegate", "10");
});
afterAll(() => stopPanel());

function Block({ state, lists, read, target, typedTo }: Shown) {
  const { store } = useSession();
  store.patch(state);
  const delegations = new DelegationReads(store);
  return createElement(MonkeyPanelProvider, { value: panel },
    createElement(Delegations, { operators: new OperatorReads(store), lists, delegations, read, target, onTarget: () => undefined, typedTo, onTypedTo: () => undefined, labelOf, titleId: "operators-title" }));
}

const render = (lists: Pick<OperatorsState, "list" | "held">, read: DelegationsState, state = UNVERIFIED, target = "", typedTo = "") =>
  renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Block, { state, lists, read, target, typedTo })));
/** The Delegate button's markup, which says whether it can be pressed. */
const delegateButton = (html: string) => /<button[^>]*>Delegate<\/button>/.exec(html)?.[0] ?? "";

describe("the delegations block while the node is unverified", () => {
  it("offers the last list verified, saying when and at which block, beside a typed address the chain alone checks", () => {
    const html = render({ list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } }, chain([]), UNVERIFIED, ALPHA);
    expect(html).toContain(`From the operator list last verified at ${formatStamp(VERIFIED_AT)} UTC, as the registry stood at final block 4,321: the node is not verified now.`);
    expect(html).toContain("Delegate to");
    expect(html).toContain('<span class="truncate">alpha.example (0x000000…00a1)</span>');
    expect(delegateButton(html)).toContain('aria-disabled="false"');
    expect(html).toContain("Or a candidate&#x27;s address");
    expect(html).toContain("An address typed here is checked only by the chain");
    expect(html).toContain("Undelegated");
  });

  it("blames the device clock, not the node, when the two disagree (monkey-trading/console#302)", () => {
    const html = render({ list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } }, chain([]), { ...UNVERIFIED, attestation: { kind: "clock", skewMs: 90_000 } });
    expect(html).toContain("final block 4,321: your device clock differs from the node&#x27;s signed time.");
  });

  it("with no list held, takes a typed address alone", () => {
    const html = render({ list: LOADING, held: null }, chain([]));
    expect(html).toContain("A candidate&#x27;s address");
    expect(html).not.toContain("Delegate to");
    expect(html).not.toContain("last verified");
    expect(html).toContain("An address typed here is checked only by the chain");
  });

  it("keeps each delegation's Take back and Move, read from the chain", () => {
    const html = render({ list: LOADING, held: null }, chain([[ALPHA, 300n * MONKEY_UNIT], [BRAVO, 200n * MONKEY_UNIT]]));
    // Each named by hostname and short address, since two candidates may register one hostname.
    expect(html).toContain("alpha.example (0x000000…00a1)</span>: 300 MONKEY");
    expect(html).toContain("bravo.example (0x000000…00b2)</span>: 200 MONKEY");
    expect(html.match(/Take back<span class="sr-only"> part of your delegation to/g)).toHaveLength(2);
    expect(html.match(/aria-expanded="false" aria-disabled="false"[^>]*>Move/g)).toHaveLength(2);
  });

  it("says when the node is verified but its list cannot be read, and offers the last list and a typed address", () => {
    const html = render({ list: { status: "failed", value: view, message: "the operator list is stale: the last read is too old" }, held: { view, verifiedAtMs: VERIFIED_AT } }, chain([]), { ...UNVERIFIED, attestation: { kind: "mock" }, stream: "live" });
    expect(html).toContain("final block 4,321: the node&#x27;s operator list cannot be read now.");
    expect(html).toContain("Or a candidate&#x27;s address");
  });

  it("chooses no candidate for the visitor: Delegate waits for a choice, a table row or a typed address", () => {
    const verified = { ...UNVERIFIED, attestation: { kind: "mock" as const }, stream: "live" as const };
    expect(render({ list: ready(view), held: null }, chain([]), verified)).toContain("Choose a candidate");
    expect(delegateButton(render({ list: ready(view), held: null }, chain([]), verified))).toContain('aria-disabled="true"');
    expect(delegateButton(render({ list: ready(view), held: null }, chain([]), verified, BRAVO))).toContain('aria-disabled="false"');
    expect(delegateButton(render({ list: LOADING, held: null }, chain([]), UNVERIFIED, "", BRAVO))).toContain('aria-disabled="false"');
  });

  it("refuses a typed address that is the zero address or fails its checksum", () => {
    const mixed = "0x52908400098527886E0F7030069857D2E4169EE7";
    expect(delegateButton(render({ list: LOADING, held: null }, chain([]), UNVERIFIED, "", "0x0000000000000000000000000000000000000000"))).toContain('aria-disabled="true"');
    expect(delegateButton(render({ list: LOADING, held: null }, chain([]), UNVERIFIED, "", mixed.replace("E7", "e7")))).toContain('aria-disabled="true"');
    expect(delegateButton(render({ list: LOADING, held: null }, chain([]), UNVERIFIED, "", mixed))).toContain('aria-disabled="false"');
  });

  it("shuts the forms while a landed change's own read again is on its way", () => {
    expect(delegateButton(render({ list: LOADING, held: null }, chain([], true), UNVERIFIED, "", BRAVO))).toContain('aria-disabled="true"');
  });

  it("opens on the chain's read alone, while the page's other re-reads, the node's proof among them, still run", async () => {
    let done = () => {};
    const pending = panel.settle(new Promise<void>((resolve) => { done = resolve; }));
    expect(panel.getSnapshot().settling).toBe(true);
    expect(delegateButton(render({ list: LOADING, held: null }, chain([]), UNVERIFIED, "", BRAVO))).toContain('aria-disabled="false"');
    done();
    await pending;
  });

  it("says when this build names no staking contract", () => {
    const html = render({ list: LOADING, held: null }, { account: WALLET.address, read: { status: "unavailable", value: null, message: null }, settling: false });
    expect(html).toContain("This build names no staking contract, so delegation is not available here.");
    // Said once, by the build, with no form to fill and no line blaming the node (monkey-trading/console#302).
    expect(html).not.toContain("does not serve");
    expect(html).not.toContain("Amount to delegate");
  });

  it("while the node is verified, chooses from its current list with no typed address", () => {
    const html = render({ list: ready(view), held: { view, verifiedAtMs: VERIFIED_AT } }, chain([]), { ...UNVERIFIED, attestation: { kind: "mock" }, stream: "live" });
    expect(html).toContain("Delegate to");
    expect(html).not.toContain("candidate&#x27;s address");
    expect(html).not.toContain("last verified");
  });
});
