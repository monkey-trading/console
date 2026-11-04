/**
 * Tests that the delegations block keeps a staker able to vote away from a node that is down or
 * unverified (monkey-trading/console#279): Take back stays, and Delegate and Move choose from the last
 * list verified, labelled with when, or a typed address the chain alone checks.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "@/lib/format";
import { LOADING, ready } from "@/lib/monkey/figures";
import { OperatorReads, type OperatorsState } from "@/lib/monkey/operators";
import { MonkeyPanel } from "@/lib/monkey/panel";
import { DelegationReads, type DelegationsState } from "@/lib/staking/delegation-reads";
import { operatorsView } from "@/lib/staking/operator-table";
import type { ConsoleState } from "@/lib/store/state";
import { formatStamp } from "@/lib/time";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { Delegations } from "./Delegations";

const WALLET = { address: "0x00000000000000000000000000000000000000aa", label: "Browser wallet" };
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
const chain = (amounts: [string, bigint][]): DelegationsState => ({
  account: WALLET.address,
  read: ready({ staked: 1_000n * MONKEY_UNIT, delegated: amounts.reduce((sum, [, amount]) => sum + amount, 0n), delegations: amounts.map(([candidate, amount]) => ({ candidate, amount })) }),
});
const labelOf = (address: string) => (address === ALPHA ? "alpha.example" : address === BRAVO ? "bravo.example" : address);

function Block({ state, lists, read }: { state: Partial<ConsoleState>; lists: Pick<OperatorsState, "list" | "held">; read: DelegationsState }) {
  const { store } = useSession();
  store.patch(state);
  const delegations = new DelegationReads(store);
  return createElement(MonkeyPanelProvider, { value: new MonkeyPanel(store, "staking") },
    createElement(Delegations, { operators: new OperatorReads(store), lists, delegations, read, target: null, onTarget: () => undefined, labelOf, titleId: "operators-title" }));
}

const render = (lists: Pick<OperatorsState, "list" | "held">, read: DelegationsState, state = UNVERIFIED) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Block, { state, lists, read })));

describe("the delegations block while the node is unverified", () => {
  it("offers the last list verified, saying when and at which block, beside a typed address the chain alone checks", () => {
    const html = render({ list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } }, chain([]));
    expect(html).toContain(`From the operator list last verified at ${formatStamp(VERIFIED_AT)} UTC, as the registry stood at final block 4,321: the node is not verified now.`);
    expect(html).toContain("Delegate to");
    expect(html).toContain("alpha.example");
    expect(html).toContain("Or a candidate&#x27;s address");
    expect(html).toContain("An address typed here is checked only by the chain");
    expect(html).toContain("Undelegated");
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

  it("while the node is verified, chooses from its current list with no typed address", () => {
    const html = render({ list: ready(view), held: { view, verifiedAtMs: VERIFIED_AT } }, chain([]), { ...UNVERIFIED, attestation: { kind: "mock" }, stream: "live" });
    expect(html).toContain("Delegate to");
    expect(html).not.toContain("candidate&#x27;s address");
    expect(html).not.toContain("last verified");
  });
});
