/**
 * Tests for the operators card rebuilt around the operator table (monkey-trading/console#309): the
 * Delegate tab's editing context and table view come from the section, so the card renders from the
 * reads and the context alone; the last list verified is labelled with when, at which block and why
 * while the node is down or unverified, its rows still delegate and move, with no list held at all
 * the Yours rows render from the chain's read alone, "Delegate to an address" takes a typed address
 * the chain alone checks, a delegation read's failure says so on the card, and the settle rules keep
 * the row's controls shut.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MONKEY_UNIT } from "@/lib/format";
import { LOADING, ready } from "@/lib/monkey/figures";
import type { OperatorsState } from "@/lib/monkey/operators";
import type { DelegationsState } from "@/lib/staking/delegation-reads";
import { amountKey, NO_EDITING, type DelegateEditing } from "@/lib/staking/delegation-form";
import { NO_TABLE_VIEW, operatorsView, type TableViewState } from "@/lib/staking/operator-table";

import { ALPHA, BRAVO, chain, HELD_LINE, panel, RELEASE, render, startPanel, stopPanelKit, UNVERIFIED, VERIFIED, VERIFIED_AT, view, WALLET } from "./operators-panel-kit";

beforeAll(startPanel);
afterAll(stopPanelKit);

describe("the operators card on the Delegate tab", () => {
  it("shows the table with the search, the All and Yours counts, the sort and the registry's final block, and no typed-address way", () => {
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: chain() });
    expect(html).toContain("As the registry stood at final block 4,321");
    expect(html.match(/>All 2</g)).toHaveLength(1);
    expect(html.match(/>Yours 1</g)).toHaveLength(1);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("aria-pressed:border-glow");
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

  it("keeps the held row and editor while a recovered node's replacement list loads, and explains a failed list", () => {
    const editing = { ...NO_EDITING, editing: { candidate: BRAVO, mode: "delegate" as const } };
    const held = { view, verifiedAtMs: VERIFIED_AT };
    for (const list of [LOADING, { status: "failed" as const, value: null, message: "the node did not answer" }]) {
      const html = render({ state: VERIFIED, operators: { route: LOADING, list, held }, read: chain(), editing });
      expect(html).toContain(`${HELD_LINE} the node&#x27;s operator list cannot be read now.`);
      expect(html).toContain("bravo.example");
      expect(html).toContain("Amount to delegate");
      expect(html).toContain('aria-expanded="true"');
    }
  });

  it("keeps chain-only rows neutral and actionable while the first verified list loads", () => {
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: LOADING, held: null }, read: chain() });
    expect(html).toContain("All —");
    expect(html).not.toContain("Unlisted");
    expect(html).toContain("0x000000…00a1");
    expect(html.match(/aria-disabled="false"[^>]*>Move<span/g)).toHaveLength(2);
    expect(html).toContain("Take back<span");
    expect(html).toContain("Delegate to an address");
  });

  it("blames the device clock, not the node, when the two disagree", () => {
    const state = { ...UNVERIFIED, attestation: { kind: "clock" as const, skewMs: 90_000 } };
    const html = render({ state, operators: { route: LOADING, list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } }, read: chain() });
    expect(html).toContain(`${HELD_LINE} your device clock differs from the node&#x27;s signed time.`);
  });

  it("with no list held, gates the typed Delegate submit on the address checksum and nonzero value", () => {
    const mixed = "0x52908400098527886E0F7030069857D2E4169EE7";
    const base = { state: UNVERIFIED, operators: { route: LOADING, list: LOADING, held: null } as OperatorsState, read: chain(false, []) };
    expect(render(base)).toContain("Delegate to an address");
    expect(render(base)).not.toContain("Search operators");
    const field = (typedTo: string) => render({ ...base, editing: { ...NO_EDITING, typedOpen: true, typedTo, amounts: { [amountKey("delegate", "typed")]: "10" } } });
    expect(field("")).toContain("A candidate&#x27;s address");
    expect(field(mixed.replace("E7", "e7"))).toContain("Enter a candidate&#x27;s 0x address of 40 hexadecimal digits, as its checksum has it.");
    expect(field("0x0000000000000000000000000000000000000000")).toContain("Enter a candidate&#x27;s 0x address");
    expect(field(mixed)).not.toContain("Enter a candidate&#x27;s 0x address");
    expect(field(mixed.replace("E7", "e7"))).toMatch(/type="submit" aria-disabled="true"[^>]*>Delegate/);
    expect(field("0x0000000000000000000000000000000000000000")).toMatch(/type="submit" aria-disabled="true"[^>]*>Delegate/);
    expect(field(mixed)).toMatch(/type="submit" aria-disabled="false"[^>]*>Delegate/);
  });

  it("keeps each delegation's Take back and Move, read from the chain, with no list held", () => {
    const read = chain(false, [
      { candidate: ALPHA, amount: 300n * MONKEY_UNIT },
      { candidate: BRAVO, amount: 200n * MONKEY_UNIT },
    ]);
    const html = render({ state: UNVERIFIED, operators: { route: LOADING, list: LOADING, held: null }, read, table: { ...NO_TABLE_VIEW, show: "yours" } });
    // No list names them: the Yours rows are the chain's read alone, each named by its address, with Move and Take back.
    expect(html).toContain("All —");
    expect(html).not.toContain("Unlisted");
    expect(html).toContain("Yours 2");
    expect(html).toContain("Showing 1–2 of 2 operators.");
    expect(html).toContain("0x000000…00a1");
    expect(html).toContain("0x000000…00b2");
    expect(html).not.toContain("Candidate");
    expect(html.match(/Take back<span class="sr-only"> part of your delegation to/g)).toHaveLength(4);
    expect(html.match(/aria-disabled="false"[^>]*>Move<span/g)).toHaveLength(4);
    expect(html).toContain("Delegate to an address");
  });

  it("opens on the chain's read alone, while the page's other re-reads, the node's proof among them, still run", async () => {
    let done = () => {};
    const pending = panel.settle(new Promise<void>((resolve) => { done = resolve; }));
    expect(panel.getSnapshot().settling).toBe(true);
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: chain() });
    expect(html.match(/aria-disabled="false"[^>]*>Delegate/g)).toHaveLength(4);
    expect(html.match(/aria-disabled="false"[^>]*>Move/g)).toHaveLength(2);
    done();
    await pending;
  });

  it("says on the card when the chain's delegation read runs or fails, and not for another account's read", () => {
    const operators = { route: LOADING, list: LOADING, held: { view, verifiedAtMs: VERIFIED_AT } } as OperatorsState;
    const loading = render({ state: UNVERIFIED, operators, read: { account: WALLET.address, read: LOADING, settling: false } });
    expect(loading).toContain('class="sr-only">Reading your delegations from the chain…');
    const broken: DelegationsState = { account: WALLET.address, read: { status: "failed", value: chain().read.value, message: "the wallet did not answer" }, settling: true };
    const failed = render({ state: UNVERIFIED, operators, read: broken });
    expect(failed).toContain("Could not read: the wallet did not answer. It is tried again at the next refresh.");
    expect(failed).toContain("300 MONKEY");
    // Another account's read is not this account's line.
    expect(render({ state: UNVERIFIED, operators, read: { ...broken, account: BRAVO } })).not.toContain("Could not read");
  });

  it("renders the page-3 and Yours-only editors supplied by the section context", () => {
    // Thirty candidates page the table; the wallet delegates to the last of them.
    const many = operatorsView({
      block: { number: 4_321, hash: `0x${"cd".repeat(32)}`, time_ms: VERIFIED_AT }, registry: ALPHA, lens: ALPHA, rotation_enabled: true,
      parameters: { epoch_length_secs: 60, min_term_secs: 0, finality_margin_secs: 60, margin_bps: 1_000, eligibility_bps: 500, quorum_bps: 2_000, max_candidates: 100, min_self_bond: "1", liveness_timeout_secs: 60 },
      open_epoch: 1, open_epoch_start_ms: 0, total_staked: "1000",
      operator_in_effect: { candidate: `0x${(1).toString(16).padStart(40, "0")}`, admin_key: ALPHA, release: RELEASE, since_ms: 0 },
      named_operator: { candidate: `0x${(1).toString(16).padStart(40, "0")}`, admin_key: ALPHA, release: RELEASE, since_ms: 0 }, pending_election: null, pending_promotion: false,
      candidates: Array.from({ length: 30 }, (_, i) => {
        const n = i + 1;
        const address = `0x${n.toString(16).padStart(40, "0")}`;
        return { address, admin_key: address, enclave: address, self_bond: "1", release: RELEASE, registration: n, api_hostname: `op-${n}.example`, handover_endpoint: "", votes: "0", eligible: true, role: "candidate" as const };
      }),
    });
    const op30 = `0x${(30).toString(16).padStart(40, "0")}`;
    const operators = { route: LOADING, list: ready(many), held: null } as OperatorsState;
    const page3: TableViewState = { search: "", sort: "role", show: "all", page: 2 };
    const editing: DelegateEditing = { ...NO_EDITING, editing: { candidate: op30, mode: "delegate" }, amounts: { [amountKey("delegate", op30)]: "7" } };
    const read = chain(false, [{ candidate: op30, amount: 700n * MONKEY_UNIT }]);
    const back = render({ state: VERIFIED, operators, read, editing, table: page3 });
    expect(back).toContain("Showing 26–30 of 30 operators.");
    expect(back).toContain("Undelegated 300 MONKEY → 293 MONKEY. Your delegation to op-30.example (0x000000…001e) 700 MONKEY → 707 MONKEY.");
    // The same for an editor on a Yours-only row: a delegation to an address the list does not name.
    const stranger = "0x00000000000000000000000000000000000000ff";
    const yoursOnly = chain(false, [{ candidate: stranger, amount: 300n * MONKEY_UNIT }]);
    const yoursView: TableViewState = { ...NO_TABLE_VIEW, show: "yours" };
    const openStranger: DelegateEditing = { ...NO_EDITING, editing: { candidate: stranger, mode: "undelegate" }, amounts: { [amountKey("undelegate", stranger)]: "5" } };
    const backAgain = render({ state: VERIFIED, operators, read: yoursOnly, editing: openStranger, table: yoursView });
    expect(backAgain).toContain("0x000000…00ff");
    expect(backAgain).toContain("Amount to take back");
    expect(backAgain).toContain('aria-expanded="true"');
  });

  it("keeps the typed-address editor while it is open, even with the field cleared and the node's list back", () => {
    const html = render({ state: VERIFIED, operators: { route: LOADING, list: ready(view), held: null }, read: chain(), editing: { ...NO_EDITING, typedOpen: true } });
    expect(html).toContain("Delegate to an address");
    expect(html).toContain("A candidate&#x27;s address");
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
    // The build's own line says it: no read note blames the node for what it never serves.
    expect(html).not.toContain("This node does not serve these figures yet.");
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
